import {
  ref,
  watch,
  isRef,
  computed,
  onBeforeUnmount,
  onMounted,
  reactive,
  getCurrentInstance,
} from 'vue'
import type { Ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'

function useRoute() {
  const route = reactive({
    query: {} as Record<string, string>,
  })

  const instance = getCurrentInstance()
  if ((instance?.proxy?.$root as any)?.$scope?.options) {
    route.query = {
      ...(instance.proxy.$root as any).$scope.options,
    }
  } else {
    onLoad((options) => {
      route.query = { ...options }
    })
  }

  return route
}

type QuerySubscriber = (payload: {
  isFetching: boolean
  isPending: boolean
  data: any
  error?: Error
  updatedAt?: number
}) => void

type QueryFn<T> = (ctx: {
  queryKey: RawQueryKey
  route: { query: Record<string, string> }
}) => Promise<T>

type InfiniteQueryFn<T> = (ctx: {
  queryKey: RawQueryKey
  route: { query: Record<string, string> }
  pageParam: any
}) => Promise<T>

const timers = new Map<string, number>()
function scheduleTimeout(hash: string, fn: () => void, ms: number) {
  const timeoutId = setTimeout(() => {
    timers.delete(hash)
    fn()
  }, ms) as unknown as number
  if (timers.has(hash)) {
    clearTimeout(timers.get(hash))
  }
  timers.set(hash, timeoutId)
}

class InfiniteQueryObserver<T = any> {
  s = new Set<QuerySubscriber>()
  isFetching = true
  isFetchingNextPage = false
  isPending = true
  updatedAt?: number
  data?: T[]
  error?: Error
  promise?: Promise<T[]>
  hasNextPage = true

  constructor(private fn: InfiniteQueryFn<T>) {}

  private broadcast() {
    this.s.forEach((subscriber) => {
      subscriber(this.getCurrent())
    })
  }

  subscribe(subscriber: QuerySubscriber) {
    if (!this.s.has(subscriber)) {
      this.s.add(subscriber)
    }
  }

  unsubscribe(subscriber: QuerySubscriber) {
    this.s.delete(subscriber)
  }

  async fetch(ctx: {
    queryKey: RawQueryKey
    route: { query: Record<string, string> }
    maxPages: number
    getNextPageParam: (lastPage: T, pages: T[]) => any
  }) {
    if (this.promise) {
      return
    }

    if (this.data === undefined) {
      this.isPending = true
    }
    this.isFetching = true
    this.hasNextPage = true

    const refresh = async () => {
      const data: T[] = []
      if (this.data?.length) {
        for (let i = 0; i < Math.min(this.data.length, ctx.maxPages); i++) {
          let pageParam: any = undefined
          if (i > 0) {
            pageParam = ctx.getNextPageParam(data[data.length - 1], data)
            if (pageParam == null) {
              this.hasNextPage = false
              break
            }
          }

          const ret = await this.fn({
            queryKey: ctx.queryKey,
            route: ctx.route,
            pageParam:
              i === 0
                ? undefined
                : ctx.getNextPageParam(data[data.length - 1], data),
          })
          data.push(ret)
        }
      } else {
        const ret = await this.fn({
          queryKey: ctx.queryKey,
          route: ctx.route,
          pageParam: undefined,
        })
        data.push(ret)
      }

      return data
    }
    this.promise = refresh()
    this.broadcast()
    try {
      const ret = await this.promise
      this.data = ret
    } catch (err: any) {
      this.error = err
    }
    this.isFetching = false
    this.isPending = false
    this.promise = undefined
    this.updatedAt = Date.now()
    if (
      this.data.length === 0 ||
      ctx.getNextPageParam(this.data[this.data.length - 1], this.data) == null
    ) {
      this.hasNextPage = false
    }
    this.broadcast()
  }

  async fetchNextPage(ctx: {
    queryKey: RawQueryKey
    route: { query: Record<string, string> }
    getNextPageParam: (lastPage: T, pages: T[]) => any
  }) {
    if (this.isFetching) {
      return
    }

    if (!this.hasNextPage) {
      return
    }

    if (!this.data || this.data.length === 0) {
      return
    }

    const nextPageParam = ctx.getNextPageParam(
      this.data[this.data.length - 1],
      this.data,
    )
    if (nextPageParam == null) {
      this.hasNextPage = false
      return
    }
    this.isFetching = true
    this.isFetchingNextPage = true
    this.promise = this.fn({ ...ctx, pageParam: nextPageParam }).then((ret) => [
      ret,
    ])
    this.broadcast()
    try {
      const ret = await this.promise
      this.data = [...this.data, ...ret]
    } catch (err: any) {
      this.error = err
    }
    this.isFetching = false
    this.isFetchingNextPage = false
    this.promise = undefined
    this.updatedAt = Date.now()
    this.broadcast()
  }

  getCurrent() {
    return {
      isFetching: this.isFetching,
      isFetchingNextPage: this.isFetchingNextPage,
      isPending: this.isPending,
      data: this.data,
      error: this.error,
      updatedAt: this.updatedAt,
      hasNextPage: this.hasNextPage,
    }
  }
}

class QueryObserver<T = any> {
  s = new Set<QuerySubscriber>()
  isFetching = true
  isPending = true
  updatedAt?: number
  data?: T
  error?: Error
  promise?: Promise<T>

  constructor(private fn: QueryFn<T>) {}

  private broadcast() {
    this.s.forEach((subscriber) => {
      subscriber(this.getCurrent())
    })
  }

  subscribe(subscriber: QuerySubscriber) {
    if (!this.s.has(subscriber)) {
      this.s.add(subscriber)
    }
  }

  unsubscribe(subscriber: QuerySubscriber) {
    this.s.delete(subscriber)
  }

  async fetch(ctx: {
    queryKey: RawQueryKey
    route: { query: Record<string, string> }
  }) {
    if (this.promise) {
      await this.promise
      return
    }

    if (this.data === undefined) {
      this.isPending = true
    }
    this.isFetching = true
    this.promise = this.fn(ctx)
    this.broadcast()
    try {
      const ret = await this.promise
      this.data = ret
    } catch (err: any) {
      this.error = err
    }
    this.isFetching = false
    this.isPending = false
    this.promise = undefined
    this.updatedAt = Date.now()
    this.broadcast()
  }

  getCurrent() {
    return {
      isFetching: this.isFetching,
      isPending: this.isPending,
      data: this.data,
      error: this.error,
      updatedAt: this.updatedAt,
    }
  }
}

const gcTime = 5 * 60 * 1000
const staleTime = 0

const map = new Map<string, QueryObserver>()
const infiniteQueryMap = new Map<string, InfiniteQueryObserver>()

// simple enough but not robust enough, should change
function hash(o: any) {
  if (typeof o === 'string' || typeof o === 'number') {
    return '' + o
  }

  return JSON.stringify(o)
}

type RawQueryKey =
  | (string | number | Record<string, RawQueryKey>)[]
  | string
  | number

type QueryKey =
  | RawQueryKey
  | Ref<RawQueryKey>
  | ((ctx: { route: { query: Record<string, string> } }) => RawQueryKey)

function useKeyRef(queryKey: QueryKey) {
  if (isRef(queryKey)) {
    return queryKey
  }
  if (typeof queryKey === 'function') {
    const route = useRoute()
    return computed(() => {
      return queryKey({ route: route as any })
    })
  }
  return ref(queryKey)
}

export function useQuery<T>({
  queryKey,
  queryFn,
  enabled,
}: {
  queryKey: QueryKey
  queryFn: QueryFn<T>
  enabled: () => boolean
}) {
  const keyRef = useKeyRef(queryKey)
  const data = ref<T | undefined>()
  const isPending = ref(true)
  const isFetching = ref(true)
  const error = ref()
  const isError = computed(() => !!error.value)
  const route = useRoute()

  function subscriber(payload: {
    isFetching: boolean
    isPending: boolean
    data: any
    error?: Error
    updatedAt?: number
  }) {
    data.value = payload.data
    isFetching.value = payload.isFetching
    isPending.value = payload.isPending
    error.value = payload.error
  }

  onMounted(() => {
    watch(
      [keyRef, enabled] as const,
      async ([k, currentEnabled], [previousK]) => {
        const kHash = hash(k)
        if (previousK) {
          const previousKHash = hash(previousK)
          // 如果 key 没有变化，直接返回
          if (previousKHash === kHash) {
            return
          }

          const previousObserver = map.get(previousKHash)
          if (previousObserver) {
            previousObserver.unsubscribe(subscriber)
            scheduleTimeout(
              previousKHash,
              () => {
                if (previousObserver.s.size === 0) {
                  if (map.get(previousKHash) === previousObserver) {
                    map.delete(previousKHash)
                  }
                }
              },
              gcTime,
            )
          }
        }

        if (!currentEnabled) {
          return
        }

        if (!map.has(kHash)) {
          map.set(kHash, new QueryObserver<T>(queryFn))
        }

        const observer = map.get(kHash)!
        observer.subscribe(subscriber)

        const current = observer.getCurrent()

        subscriber(current)

        if (current.data && Date.now() - (current.updatedAt ?? 0) < staleTime) {
          return
        }
        observer.fetch({ queryKey: k, route: route as any })
      },
      {
        immediate: true,
      },
    )
  })

  function refetch() {}

  onBeforeUnmount(() => {
    const kHash = hash(keyRef.value)
    const observer = map.get(kHash)
    if (observer) {
      observer.unsubscribe(subscriber)
      scheduleTimeout(
        kHash,
        () => {
          if (observer.s.size === 0) {
            if (map.get(kHash) === observer) {
              map.delete(kHash)
            }
          }
        },
        gcTime,
      )
    }
  })

  return {
    data,
    isPending,
    isFetching,
    isError,
    error,
    refetch,
  }
}

export function useInfiniteQuery<T>({
  queryKey,
  queryFn,
  enabled,
  getNextPageParam,
  maxPages,
  staleTime,
}: {
  queryKey: QueryKey
  queryFn: InfiniteQueryFn<T>
  enabled: () => boolean
  getNextPageParam: (lastPage: T, pages: T[]) => any
  maxPages: number | undefined
  staleTime: number
}) {
  const keyRef = useKeyRef(queryKey)
  const data = ref<T[] | undefined>()
  const isPending = ref(true)
  const isFetching = ref(true)
  const isFetchingNextPage = ref(false)
  const hasNextPage = ref(true)
  const error = ref()
  const isError = computed(() => !!error.value)
  const route = useRoute()

  function subscriber(payload: {
    isFetching: boolean
    isPending: boolean
    data: any
    error?: Error
    updatedAt?: number
    isFetchingNextPage: boolean
    hasNextPage: boolean
  }) {
    data.value = payload.data
    isFetching.value = payload.isFetching
    isPending.value = payload.isPending
    error.value = payload.error
    isFetchingNextPage.value = payload.isFetchingNextPage
    hasNextPage.value = payload.hasNextPage
  }

  onMounted(() => {
    watch(
      [keyRef, enabled] as const,
      async ([k, currentEnabled], [previousK]) => {
        const kHash = hash(k)
        if (previousK) {
          const previousKHash = hash(previousK)
          // 如果 key 没有变化，直接返回
          if (previousKHash === kHash) {
            return
          }

          const previousObserver = infiniteQueryMap.get(previousKHash)
          if (previousObserver) {
            previousObserver.unsubscribe(subscriber)
            scheduleTimeout(
              previousKHash,
              () => {
                if (previousObserver.s.size === 0) {
                  if (
                    infiniteQueryMap.get(previousKHash) === previousObserver
                  ) {
                    infiniteQueryMap.delete(previousKHash)
                  }
                }
              },
              gcTime,
            )
          }
        }

        if (!currentEnabled) {
          return
        }

        if (!infiniteQueryMap.has(kHash)) {
          infiniteQueryMap.set(kHash, new InfiniteQueryObserver<T>(queryFn))
        }

        const observer = infiniteQueryMap.get(kHash)!
        observer.subscribe(subscriber)

        const current = observer.getCurrent()

        subscriber(current)

        if (current.data && Date.now() - (current.updatedAt ?? 0) < staleTime) {
          return
        }
        observer.fetch({
          queryKey: k,
          route: route as any,
          getNextPageParam,
          maxPages: maxPages ?? Infinity,
        })
      },
      {
        immediate: true,
      },
    )
  })

  function fetchNextPage() {
    const kHash = hash(keyRef.value)
    const observer = infiniteQueryMap.get(kHash)
    if (observer) {
      observer.fetchNextPage({
        queryKey: keyRef.value,
        route: route as any,
        getNextPageParam,
      })
    }
  }

  onBeforeUnmount(() => {
    const kHash = hash(keyRef.value)
    const observer = infiniteQueryMap.get(kHash)
    if (observer) {
      observer.unsubscribe(subscriber)
      scheduleTimeout(
        kHash,
        () => {
          if (observer.s.size === 0) {
            if (infiniteQueryMap.get(kHash) === observer) {
              infiniteQueryMap.delete(kHash)
            }
          }
        },
        gcTime,
      )
    }
  })

  return {
    data,
    isPending,
    isFetching,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
  }
}
