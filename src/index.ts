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
import { onLoad, onShow } from '@dcloudio/uni-app'

// status: fetching | paused | idle
// status: pending | error | success

function useRoute() {
  const route = reactive({
    query: {} as Record<string, string>,
  })

  const instance = getCurrentInstance()
  if ((instance?.proxy?.$root as any)?.$scope?.options) {
    route.query = {
      ...(instance!.proxy!.$root as any).$scope.options,
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
  isOnInvalidate?: boolean
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
  pageParams?: unknown[]
  error?: Error
  promise?: Promise<{
    pages: T[]
    pageParams: unknown[]
  }>
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

  invalidate() {
    this.s.forEach((subscriber) => {
      subscriber({
        ...this.getCurrent(),
        isOnInvalidate: true,
      })
    })
  }

  async fetch(ctx: {
    queryKey: RawQueryKey
    route: { query: Record<string, string> }
    maxRefetchPages: number
    getNextPageParam: (lastPage: T, pages: T[]) => any
  }) {
    if (this.promise) {
      return
    }

    if (this.data === undefined) {
      this.isPending = true
    }
    this.error = undefined
    this.isFetching = true
    this.hasNextPage = true

    const refresh = async () => {
      const data: T[] = []
      const pageParams: unknown[] = []
      if (this.data?.length) {
        for (
          let i = 0;
          i < Math.min(this.data.length, ctx.maxRefetchPages);
          i++
        ) {
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
          pageParams.push(pageParam)
        }
      } else {
        const ret = await this.fn({
          queryKey: ctx.queryKey,
          route: ctx.route,
          pageParam: undefined,
        })
        data.push(ret)
        pageParams.push(undefined)
      }

      return {
        pages: data,
        pageParams,
      }
    }

    this.promise = refresh()
    this.broadcast()
    try {
      const ret = await this.promise
      this.data = ret.pages
      this.pageParams = ret.pageParams
    } catch (err: any) {
      this.error = err
    }
    this.isFetching = false
    this.isPending = false
    this.promise = undefined
    this.updatedAt = Date.now()
    if (
      this.data!.length === 0 ||
      ctx.getNextPageParam(this.data![this.data!.length - 1], this.data!) ==
        null
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
    this.promise = this.fn({ ...ctx, pageParam: nextPageParam }).then((ret) => {
      return {
        pages: [ret],
        pageParams: [nextPageParam],
      }
    })
    this.broadcast()
    try {
      const ret = await this.promise
      this.data = [...this.data, ...ret.pages]
      this.pageParams = [...this.pageParams!, ...ret.pageParams]
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
      pageParams: this.pageParams,
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

  invalidate() {
    this.s.forEach((subscriber) => {
      subscriber({
        ...this.getCurrent(),
        isOnInvalidate: true,
      })
    })
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
    this.error = undefined
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

const map = new Map<string, QueryObserver>()
const infiniteQueryMap = new Map<string, InfiniteQueryObserver>()

// simple enough but not robust enough, should change
export function hash(o: any) {
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

type BaseObserver<QuerySubscriber> = {
  s: Set<QuerySubscriber>
  subscribe(subscriber: QuerySubscriber): void
  unsubscribe(subscriber: QuerySubscriber): void
  getCurrent(): { data: any; updatedAt?: number }
}

function useQueryObserverLifecycle<
  Subscriber extends (...args: any) => void,
  Observer extends BaseObserver<Subscriber>,
>({
  queryKey,
  enabled,
  staleTime,
  refetchOnShow,
  map,
  subscriber,
  createObserver,
  observerFetch,
}: {
  queryKey: QueryKey
  enabled?: () => boolean
  staleTime: number
  refetchOnShow: boolean | undefined
  map: Map<string, Observer>
  subscriber: Subscriber
  createObserver: () => Observer
  observerFetch: (observer: Observer) => void
}) {
  enabled = enabled || (() => true)
  const keyRef = useKeyRef(queryKey)
  const onShowTimestamp = ref(0)

  function cleanSubscriber(hash: string) {
    const previousObserver = map.get(hash)
    if (previousObserver) {
      previousObserver.unsubscribe(subscriber)
      scheduleTimeout(
        hash,
        () => {
          if (previousObserver.s.size === 0) {
            if (map.get(hash) === previousObserver) {
              map.delete(hash)
            }
          }
        },
        gcTime,
      )
    }
  }

  onMounted(() => {
    watch(
      [keyRef, enabled, onShowTimestamp] as const,
      async ([k, currentEnabled], [previousK]) => {
        const kHash = hash(k)

        // 如果 key 发生变化，清理上一个 key 的 observer
        if (previousK) {
          const previousKHash = hash(previousK)
          if (previousKHash !== kHash) {
            cleanSubscriber(previousKHash)
          }
        }

        // 如果没有开启，直接返回
        if (typeof currentEnabled === 'boolean' && !currentEnabled) {
          cleanSubscriber(kHash)
          return
        }

        if (!map.has(kHash)) {
          map.set(kHash, createObserver())
        }

        const observer = map.get(kHash)!
        observer.subscribe(subscriber)

        const current = observer.getCurrent()

        subscriber(current)

        // 数据还没过期
        if (current.data && Date.now() - (current.updatedAt ?? 0) < staleTime) {
          return
        }

        observerFetch(observer)
      },
      {
        immediate: true,
      },
    )
  })

  if (refetchOnShow) {
    onShow(() => {
      onShowTimestamp.value = Date.now()
    })
  }

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
}

export function useQuery<T>({
  queryKey,
  queryFn,
  enabled,
  refetchOnShow,
  staleTime,
}: {
  queryKey: QueryKey
  queryFn: QueryFn<T>
  enabled?: () => boolean
  refetchOnShow?: boolean
  staleTime?: number
}) {
  const keyRef = useKeyRef(queryKey)
  const data = ref<T | undefined>()
  const isPending = ref(true)
  const isFetching = ref(false)
  const error = ref()
  const isError = computed(() => !!error.value)
  const route = useRoute()
  const updatedAt = ref(-1)

  staleTime = staleTime ?? 0

  function subscriber(payload: {
    isFetching: boolean
    isPending: boolean
    data: any
    error?: Error
    updatedAt?: number
    isOnInvlidate?: boolean
  }) {
    if (payload.isOnInvlidate) {
      refetch()
      return
    }

    data.value = payload.data
    isFetching.value = payload.isFetching
    isPending.value = payload.isPending
    error.value = payload.error
    if (payload.updatedAt) {
      updatedAt.value = payload.updatedAt
    }
  }

  useQueryObserverLifecycle({
    queryKey,
    enabled,
    staleTime,
    refetchOnShow,
    map,
    subscriber,
    createObserver: () => new QueryObserver(queryFn),
    observerFetch: (observer) => {
      observer.fetch({ queryKey: keyRef.value, route: route as any })
    },
  })

  function refetch() {
    const kHash = hash(keyRef.value)
    const observer = map.get(kHash)
    if (observer) {
      observer.fetch({ queryKey: keyRef.value, route: route as any })
    }
  }

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
  maxRefetchPages,
  staleTime,
  refetchOnShow,
}: {
  queryKey: QueryKey
  queryFn: InfiniteQueryFn<T>
  enabled?: () => boolean
  getNextPageParam: (lastPage: T, pages: T[]) => any
  maxRefetchPages: number | undefined
  staleTime?: number
  refetchOnShow?: boolean
}) {
  refetchOnShow = refetchOnShow || false

  const keyRef = useKeyRef(queryKey)
  const data = ref<T[] | undefined>()
  const pageParams = ref<unknown[] | undefined>()
  const isPending = ref(true)
  const isFetching = ref(false)
  const isFetchingNextPage = ref(false)
  const hasNextPage = ref(true)
  const error = ref()
  const isError = computed(() => !!error.value)
  const route = useRoute()
  const updatedAt = ref(-1)

  staleTime = staleTime ?? 0

  function subscriber(payload: {
    isFetching: boolean
    isPending: boolean
    data: any
    error?: Error
    updatedAt?: number
    isFetchingNextPage: boolean
    hasNextPage: boolean
    pageParams: unknown[]
    isOnInvalidate?: boolean
  }) {
    if (payload.isOnInvalidate) {
      const kHash = hash(keyRef.value)
      const observer = infiniteQueryMap.get(kHash)
      if (observer) {
        observer.fetch({
          queryKey: keyRef.value,
          route: route as any,
          getNextPageParam,
          maxRefetchPages: maxRefetchPages ?? Infinity,
        })
      }
      return
    }

    data.value = payload.data
    isFetching.value = payload.isFetching
    isPending.value = payload.isPending
    error.value = payload.error
    isFetchingNextPage.value = payload.isFetchingNextPage
    hasNextPage.value = payload.hasNextPage
    updatedAt.value = payload.updatedAt ?? 0
    pageParams.value = payload.pageParams
  }

  useQueryObserverLifecycle({
    queryKey,
    enabled,
    staleTime,
    refetchOnShow,
    map: infiniteQueryMap,
    subscriber,
    createObserver: () => new InfiniteQueryObserver(queryFn),
    observerFetch: (observer) => {
      observer.fetch({
        queryKey: keyRef.value,
        route: route as any,
        getNextPageParam,
        maxRefetchPages: maxRefetchPages ?? Infinity,
      })
    },
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

  return {
    data: computed(() => {
      if (!data.value) {
        return undefined
      }
      return {
        pages: data.value,
        pageParams: pageParams.value,
      }
    }),
    isPending,
    isFetching,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
  }
}

export function useQueryClient() {
  function invalidateQueries({ queryKey }: { queryKey: RawQueryKey }) {
    const kHash = hash(queryKey)
    const maps = [map, infiniteQueryMap]
    maps.forEach((map) => {
      const observer = map.get(kHash)
      if (observer) {
        observer.invalidate()
      }
    })
  }

  return {
    invalidateQueries,
  }
}

export const queryMap = map
export { infiniteQueryMap }
