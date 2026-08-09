'use client'

import { useEffect, useState } from 'react'
import {
  onSnapshot,
  query,
  queryEqual,
  type CollectionReference,
  type DocumentData,
  type Query,
  type QueryConstraint,
} from 'firebase/firestore'

interface UseCollectionResult<T> {
  data: T[]
  loading: boolean
  error: Error | null
}

/**
 * Subscribe to a Firestore collection with real-time updates.
 *
 * @example
 * const { data, loading, error } = useCollection(usersCollection, where('role', '==', 'admin'))
 */
export function useCollection<T extends DocumentData>(
  collectionRef: CollectionReference<T>,
  ...queryConstraints: QueryConstraint[]
): UseCollectionResult<T> {
  const [data, setData] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  // `where(...)` etc. return a new object every render, so we can't put the raw
  // constraints in the effect's dependency array without resubscribing (and
  // re-triggering this same render) on every single snapshot. Keep the same
  // Query instance across renders unless it's actually semantically different.
  const q: Query<T> =
    queryConstraints.length > 0 ? query(collectionRef, ...queryConstraints) : query(collectionRef)
  const [stableQuery, setStableQuery] = useState(q)
  if (!queryEqual(stableQuery, q)) {
    setStableQuery(q)
  }

  useEffect(() => {
    const unsubscribe = onSnapshot(
      stableQuery,
      (snapshot) => {
        setData(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as T[])
        setLoading(false)
      },
      (err) => {
        setError(err)
        setLoading(false)
      }
    )

    return () => unsubscribe()
  }, [stableQuery])

  return { data, loading, error }
}
