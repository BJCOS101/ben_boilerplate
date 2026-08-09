import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { CollectionReference, DocumentData } from 'firebase/firestore'

/**
 * Fake Firestore query objects are identified by a `key` string so the mocked
 * `queryEqual` can model real semantic (not referential) equality — `where()`
 * returns a brand new object on every render, which is the whole reason the
 * hook needs `queryEqual` in the first place.
 */
interface FakeConstraint {
  key: string
}
interface FakeQuery {
  key: string
}

const { onSnapshotMock } = vi.hoisted(() => ({ onSnapshotMock: vi.fn() }))

vi.mock('firebase/firestore', () => ({
  where: (field: string, op: string, value: unknown): FakeConstraint => ({
    key: `${field}:${op}:${String(value)}`,
  }),
  query: (_ref: unknown, ...constraints: FakeConstraint[]): FakeQuery => ({
    key: constraints.map((c) => c.key).join('|'),
  }),
  queryEqual: (a: FakeQuery, b: FakeQuery): boolean => a.key === b.key,
  onSnapshot: onSnapshotMock,
}))

const { useCollection } = await import('@/hooks/useFirestore')
const { where } = await import('firebase/firestore')

interface Note extends DocumentData {
  title: string
}

// The hook only forwards this to query(), which the mock ignores.
const notesRef = {} as CollectionReference<Note>

const unsubscribe = vi.fn()

beforeEach(() => {
  onSnapshotMock.mockReset()
  unsubscribe.mockReset()
  onSnapshotMock.mockReturnValue(unsubscribe)
})

describe('useCollection', () => {
  it('resubscribes when a query constraint changes', () => {
    // Regression: the effect previously depended on the collection ref alone, so
    // the listener stayed bound to the first render's query. With an auth-derived
    // constraint (uid is '' until auth resolves) the subscription was stuck
    // querying uid === '' forever and new documents never arrived.
    const { rerender } = renderHook(({ uid }) => useCollection(notesRef, where('uid', '==', uid)), {
      initialProps: { uid: '' },
    })

    expect(onSnapshotMock).toHaveBeenCalledTimes(1)
    expect((onSnapshotMock.mock.calls[0]![0] as FakeQuery).key).toBe('uid:==:')

    rerender({ uid: 'user-123' })

    expect(onSnapshotMock).toHaveBeenCalledTimes(2)
    expect((onSnapshotMock.mock.calls[1]![0] as FakeQuery).key).toBe('uid:==:user-123')
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('does not resubscribe when re-rendered with an equivalent constraint', () => {
    // Regression: naively spreading the raw constraints into the dependency array
    // resubscribed on every render, because where() returns a new object each time.
    const { rerender } = renderHook(({ uid }) => useCollection(notesRef, where('uid', '==', uid)), {
      initialProps: { uid: 'user-123' },
    })

    expect(onSnapshotMock).toHaveBeenCalledTimes(1)

    rerender({ uid: 'user-123' })
    rerender({ uid: 'user-123' })

    expect(onSnapshotMock).toHaveBeenCalledTimes(1)
    expect(unsubscribe).not.toHaveBeenCalled()
  })

  it('exposes documents from the snapshot with their ids', () => {
    onSnapshotMock.mockImplementation((_q: FakeQuery, onNext: (snap: unknown) => void) => {
      onNext({ docs: [{ id: 'note-1', data: () => ({ title: 'First' }) }] })
      return unsubscribe
    })

    const { result } = renderHook(() => useCollection(notesRef, where('uid', '==', 'user-123')))

    expect(result.current.data).toEqual([{ id: 'note-1', title: 'First' }])
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('surfaces subscription errors and stops loading', () => {
    const failure = new Error('Missing or insufficient permissions.')
    onSnapshotMock.mockImplementation(
      (_q: FakeQuery, _onNext: (snap: unknown) => void, onError: (err: Error) => void) => {
        onError(failure)
        return unsubscribe
      }
    )

    const { result } = renderHook(() => useCollection(notesRef, where('uid', '==', 'user-123')))

    expect(result.current.error).toBe(failure)
    expect(result.current.loading).toBe(false)
    expect(result.current.data).toEqual([])
  })

  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useCollection(notesRef, where('uid', '==', 'user-123')))

    unmount()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
