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
import type { Ref, App } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'

let beforeResolveOptions = (options: any) => options

// status: fetching | paused | idle
// status: pending | error | success

export function useRoute() {
  const route = reactive({
    query: {} as Record<string, string>,
    inited: false,
  })

  const instance = getCurrentInstance()
  if ((instance?.proxy?.$root as any)?.$scope?.options) {
    route.query = {
      ...beforeResolveOptions((instance!.proxy!.$root as any).$scope.options),
    }
    route.inited = true
    // @ts-ignore
  } else if (typeof instance?.proxy?.$getAppWebview === 'function') {
    let page = getCurrentPages().find((p) => {
      if (typeof p.$getAppWebview === 'function') {
        return (
          // @ts-ignore
          p.$getAppWebview().__uuid__ ===
          // @ts-ignore
          instance?.proxy?.$getAppWebview().__uuid__
        )
      }
      return false
    })
    // @ts-ignore
    route.query = beforeResolveOptions({ ...page?.$page.options })
    route.inited = true
  } else {
    onLoad((options) => {
      route.query = beforeResolveOptions({ ...options })
      route.inited = true
    })
  }

  return route
}

function getEnabled(route: { inited: boolean }, enabled?: () => boolean) {
  return () => {
    if (enabled) {
      return enabled() && route.inited
    }
    return route.inited
  }
}

type QuerySubscriber = (payload: {
  isFetching: boolean
  isPending: boolean
  data: any
  error?: Error
  updatedAt?: number
  isOnInvalidate?: boolean
}) => any

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

  async invalidate() {
    for (const subscriber of this.s) {
      const ret = subscriber({
        ...this.getCurrent(),
        isOnInvalidate: true,
      })
      if (ret?.then) {
        await ret
      }
    }
  }

  async fetch(ctx: {
    queryKey: RawQueryKey
    route: { query: Record<string, string> }
    maxRefetchPages: number
    getNextPageParam: (lastPage: T, pages: T[]) => any
  }) {
    if (this.promise) {
      await this.promise
      return
    }

    if (this.data === undefined) {
      this.isPending = true
    } else {
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
      this.broadcast()
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

  async invalidate() {
    for (const subscriber of this.s) {
      const ret = subscriber({
        ...this.getCurrent(),
        isOnInvalidate: true,
      })
      if (ret?.then) {
        await ret
      }
    }
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

const DEFAULT_GC_TIME = 5 * 60 * 1000

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
  gcTime,
}: {
  queryKey: QueryKey
  enabled: () => boolean
  staleTime: number
  refetchOnShow: boolean | undefined
  map: Map<string, Observer>
  subscriber: Subscriber
  createObserver: () => Observer
  observerFetch: (observer: Observer) => void
  gcTime?: number
}) {
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
        gcTime ?? DEFAULT_GC_TIME,
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
        if (!currentEnabled) {
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
        gcTime ?? DEFAULT_GC_TIME,
      )
    }
  })
}

/**
 * 使用 useQuery 声明一个绑定到唯一键的异步数据源
 *
 * ## 获取 todo 详情
 *
 * ```js
 * const { data, error, isPending, isFetching, isError } = useQuery({
 *   queryKey: computed(() => ['todo', { id: todoId.value }]),
 *   queryFn: async () => {
 *     const todo = await fetchTodo(todoId.value)
 *     return {
 *       ...todo,
 *       formattedCreatedTime: dayjs(todo.createdTime).format('YYYY-MM-DD HH:mm')
 *     }
 *   }
 * })
 * ```
 *
 * ## 读取路由中的参数
 *
 * ```js
 * const { data, error, isPending, isFetching, isError } = useQuery({
 *   // 你可以使用 queryKey 的函数形式，能够拿到 route 读取路由参数
 *   queryKey: ({ route }) => ['todo', { id: route.query.id }],
 *   // 在 queryFn 中，也能拿到 route 参数
 *   queryFn: async ({ route }) => {
 *     return fetchTodo(route.id)
 *   }
 * })
 * ```
 *
 * ## query 之间依赖
 *
 * ```js
 * const userId = ref(1)
 * const todoId = ref(1)
 *
 * const { data: user } = useQuery({
 *   queryKey: () => ['user', { id: userId.value }],
 *   queryFn: async () => {
 *     return fetchUser(userId.value)
 *   },
 * })
 *
 * // 等到 user 有数据，再去发起请求
 * const { data: todo } = useQuery({
 *   queryKey: () => ['todo', { userId: userId.value }],
 *   queryFn: async () => {
 *     return fetchTodosByUserId(userId.value)
 *   },
 *   enabled: () => !!user.value.id,
 * })
 * ```
 *
 * ## enabled
 *
 * ```js
 * // 假设用户登录态存在在 userStore 里面
 * const userStore = useUserStore()
 *
 * const { data, error, isPending, isFetching, isError } = useQuery({
 *   queryKey: ({ route }) => ['todo', { id: route.query.id }],
 *   queryFn: async ({ route }) => {
 *     return fetchMyTodo(route.id)
 *   },
 *   // enabled 是一个返回响应式数据的函数，当响应式数据为 true 时，queryFn 才会被执行
 *   enabled: () => userStore.isLogin,
 * })
 * ```
 *
 * ## 过期时间
 *
 * ```js
 * // 默认过期时间为 0，也就是当 useQuery 重新触发的时候，都会重新去拉取数据
 * // 但如果你的场景数据可以忍受数据不是最新的，可以加长 staleTime
 * const { data } = useQuery({
 *   ...,
 *   staleTime: 5 * 1000,
 * })
 * ```
 *
 * ## onShow 触发数据更新
 *
 * ```js
 * const { data } = useQuery({
 *   ...,
 *   staleTime: 5 * 1000,
 *   // 当 onShow 触发的时候，监测是否要刷新数据
 *   refetchOnShow: true
 * })
 * ```
 */
export function useQuery<T>({
  queryKey,
  queryFn,
  enabled,
  refetchOnShow,
  staleTime,
  gcTime,
}: {
  queryKey: QueryKey
  queryFn: QueryFn<T>
  enabled?: () => boolean
  refetchOnShow?: boolean
  staleTime?: number
  gcTime?: number
}) {
  const keyRef = useKeyRef(queryKey)
  const data = ref<T | undefined>()
  const isPending = ref(true)
  const isFetching = ref(false)
  const error = ref()
  const isError = computed(() => !!error.value)
  const route = useRoute()
  const updatedAt = ref(-1)
  enabled = getEnabled(route, enabled)

  staleTime = staleTime ?? 0

  function subscriber(payload: {
    isFetching: boolean
    isPending: boolean
    data: any
    error?: Error
    updatedAt?: number
    isOnInvalidate?: boolean
  }) {
    if (payload.isOnInvalidate) {
      return refetch()
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
      return observer.fetch({ queryKey: keyRef.value, route: route as any })
    },
    gcTime,
  })

  async function refetch() {
    const kHash = hash(keyRef.value)
    const observer = map.get(kHash)
    if (observer) {
      return observer.fetch({ queryKey: keyRef.value, route: route as any })
    }
  }

  return {
    data,
    isPending,
    isFetching,
    isSuccess: computed(() => !isPending.value && !!data.value),
    isError,
    error,
    refetch,
  }
}

/**
 * 使用 useQuery 声明一个绑定到唯一键的无限滚动类型的异步数据源
 *
 * ## InfiniteQuery
 *
 * ```js
 * // 与 useQuery 不同，此时 data.value 的数据结构为 { pages: T[] }
 * // fetchNextPage 用来获取下一页
 * // hasNextPage 代表是否还有下一页
 * // 其他与 useQuery 相同
 * const { data, fetchNextPage, hasNextPage, error, isError, isPending, isFetching, isFetchingNextPage } = useInfiniteQuery({
 *   queryKey: () => ['todos'],
 *   // pageParam 上一次 getNextPageParam 返回的数据，可以返回任何数据
 *   // 一般来说，比如无限滚动，返回的可能是对应的 cursor 或者 offset
 *   // 请求第一页数据的时候，pageParam 为 undefined
 *   queryFn: async ({ pageParam }) => {
 *     return fetchTodos({ cursor: pageParam })
 *   },
 *   getNextPageParam(lastPage, pages) {
 *     // 返回 undefined，说明没有更多数据了，hasNextPage 变为 false
 *     if (lastPage.length === 0) {
 *       return undefined
 *     }
 *     return lastPage[lastPage.length - 1].id
 *   }
 * })
 *
 * // data.pages 为分页数据对应的数据，一般来说，你还需要自己对其进行处理
 * // 比如说分页数据，第一页返回的是 { data: [1] }，第二页返回的是 { data: [2] }
 * // 那么 data.pages 为 [{ data: [1] }, { data: [2] }]
 * // 很多时候，你会想要把其转换为一个数组
 * const items = computed(() => data.value?.pages?.flatMap(page => page.data) ?? [])
 *
 * // 触底，请求下一页
 * onReachBottom(() => {
 *   fetchNextPage()
 * })
 * ```
 *
 * ## 触发重新获取数据，控制刷新数据的页数
 *
 * ```js
 * const { ... } = useInfiniteQuery({
 *   ...
 *   // 最多刷新 5 页，丢弃后面的数据（如果大于 5 页）
 *   maxRefetchPages: 5,
 * })
 * ```
 */
export function useInfiniteQuery<T>({
  queryKey,
  queryFn,
  enabled,
  getNextPageParam,
  maxRefetchPages,
  staleTime,
  refetchOnShow,
  gcTime,
}: {
  queryKey: QueryKey
  queryFn: InfiniteQueryFn<T>
  enabled?: () => boolean
  getNextPageParam: (lastPage: T, pages: T[]) => any
  maxRefetchPages: number | undefined
  staleTime?: number
  refetchOnShow?: boolean
  gcTime?: number
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
  enabled = getEnabled(route, enabled)

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
        return observer.fetch({
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
      return observer.fetch({
        queryKey: keyRef.value,
        route: route as any,
        getNextPageParam,
        maxRefetchPages: maxRefetchPages ?? Infinity,
      })
    },
    gcTime,
  })

  function fetchNextPage() {
    const kHash = hash(keyRef.value)
    const observer = infiniteQueryMap.get(kHash)
    if (observer) {
      return observer.fetchNextPage({
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
    isSuccess: computed(() => !isPending.value && !!data.value),
    isError,
    error,
    fetchNextPage,
    hasNextPage,
  }
}

/**
 * 用命令式的方式控制管理的 queries
 *
 * ## 使数据失效
 *
 * 你更新了一条数据，并且想更新数据，使界面展现最新的数据，使用 invalidateQueries，可以重新获取某个 queryKey 对应的数据
 *
 * ```js
 * const queryClient = useQueryClient()
 *
 * async function updateTodo(id) {
 *   await updateTodoById(id)
 *   queryClient.invalidateQueries({ queryKey: ['todo', { id } ]})
 * }
 * ```
 */
export function useQueryClient() {
  async function invalidateQueries({ queryKey }: { queryKey: RawQueryKey }) {
    const kHash = hash(queryKey)
    for (const m of [map, infiniteQueryMap]) {
      const observer = m.get(kHash)
      if (observer) {
        await observer.invalidate()
      }
    }
  }

  return {
    invalidateQueries,
  }
}

export const TaubePlugin = (
  app: App,
  options: {
    beforeResolveOptions?: (options: any) => any
  } = {},
) => {
  if (options.beforeResolveOptions) {
    beforeResolveOptions = options.beforeResolveOptions
  }
}

export const queryMap = map
export { infiniteQueryMap }
