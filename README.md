# Taube

> [!IMPORTANT]
> This repo is under heavy development

A lightweight data-fetching library for uni-app similar to [TanStack Query](https://tanstack.com/query/latest/docs/framework/vue/overview)

为了更好的去理解这个库想解决的问题以及作用，请仔细阅读一遍 [TanStack Query](https://tanstack.com/query/latest/docs/framework/vue/overview)

## 为什么不直接用 TanStack Query？

- 这个库主要是为了在 uni-app 中（特别是小程序环境）中使用，TanStack Query 存在不兼容的问题
- 小程序运行时与 Web 存在差异，这个库的 API 在保持与 TanStack Query 尽量一致的情况下，新增了一些改动，保证了开发体验
- 我们的小程序是一个功能非常多的应用，在包体积上需要非常注意，这个库是一个非常轻量级的替代，仅支持了我们业务中需要频繁使用到的 API

总之，这个库主要用于 uni-app，如果你在开发 Web 应用，请使用 TanStack Query

## Cheat Sheats

### 最简例子

```js
const todoId = ref(1)

// data: queryFn 返回的数据
// error: queryFn 发生了错误
//
// isPending: data 还没有数据
// isError: 发生了错误
// isFetching: 有一个请求正在进行中
//
// isPending 和 isFetching 的不同：
// isFetching 指示的是请求状态
// 说明现在正在请求数据，有可能是初次请求，也有可能是在刷新数据
// isPending 表示的是数据是否存在了，但数据不一定是最新的，可能是缓存中的数据
const { data, error, isPending, isFetching, isError } = useQuery({
  /**
   * queryKey 可以是一个可以序列化的数组（plain object），可以是这样一个数组的 computed 或者 ref 形式
   * 或者是一个返回响应式数据的函数，如：
   * ['todo', { id: 1 }]
   * 
   * const todoQueryKey = ref(['todo', { id: 1 }])
   * queryKey: todoQueryKey
   * 
   * const todoId = ref(1)
   * queryKey: computed(() => ['todo', { id : todoId.value }])
   * 
   * const todoId = ref(1)
   * queryKey: () => ['todo', { id: todoId.value }]
   * 
   * 当 queryKey 是响应式数据的时候
   * queryKey 发生变化的时候，taube 会自动重新请求数据，你无需关心各种跟请求相关的逻辑
   * 只需要读取 useQuery 返回的响应式数据去渲染界面即可
   */
  queryKey: computed(() => ['todo', { id: todoId.value }]),
  queryFn: async () => {
    const todo = await fetchTodo(todoId.value)
    // 在这里，你还能做一些数据格式转换
    return {
      ...todo,
      formattedCreatedTime: dayjs(todo.createdTime).format('YYYY-MM-DD HH:mm')
    }
  }
})
```

### 读取路由中的参数

这是与 TanStack 一个不同的地方，因为在 Web 中，当组件渲染的时候，就已经知道 route 了，可以同步地使用 `useRoute` 拿参数，而在小程序中，需要在 `onLoad` 之后才能拿到路由，因此拿路由参数封装到了 `useQuery` 中

```js
const { data, error, isPending, isFetching, isError } = useQuery({
  // 你可以使用 queryKey 的函数形式，能够拿到 route 读取路由参数
  queryKey: ({ route }) => ['todo', { id: route.query.id }],
  // 在 queryFn 中，也能拿到 route 参数
  queryFn: async ({ route }) => {
    return fetchTodo(route.id)
  }
})
```

### enabled

这里的一个场景，比如说我们需要等待用户登录后，才去获取某些数据

原来的方式可能是去 watch 登录态变化，并且执行一些逻辑，业务逻辑可能会比较混杂

```js
// 假设用户登录态存在在 userStore 里面
const userStore = useUserStore()

const { data, error, isPending, isFetching, isError } = useQuery({
  queryKey: ({ route }) => ['todo', { id: route.query.id }],
  queryFn: async ({ route }) => {
    return fetchMyTodo(route.id)
  },
  // enabled 是一个返回响应式数据的函数，当响应式数据为 true 时，queryFn 才会被执行
  enabled: () => userStore.isLogin
})
```

### 请求依赖

一个 useQuery 依赖于另一个 useQuery，可以依赖 `enabled` 的能力做

```js
const userId = ref(1)
const todoId = ref(1)

const { data: user } = useQuery({
  queryKey: () => ['user', { id: userId.value }],
  queryFn: async () => {
    return fetchUser(userId.value)
  },
})

// 等到 user 有数据，再去发起请求
const { data: todo } = useQuery({
  queryKey: () => ['todo', { userId: userId.value }],
  queryFn: async () => {
    return fetchTodosByUserId(userId.value)
  },
  enabled: () => !!user.value.id,
})
```

### 过期时间

```js
// 默认过期时间为 0，也就是当 useQuery 重新触发的时候，都会重新去拉取数据
// 但如果你的场景数据可以忍受数据不是最新的，可以加长 staleTime
const { data } = useQuery({
  ...,
  staleTime: 5 * 1000,
}) 
```

### onShow 的触发数据更新

以下代码场景：

比如这个 useQuery 在页面 A，切换到页面 B，然后切换回页面 A，如果这个时候离请求完成时间超过了 5s（staleTime），就会重新发起请求，如果触发 onShow 的时候，小于 5s，则不会重新发起请求

```js
const { data } = useQuery({
  ...,
  staleTime: 5 * 1000,
  // 当 onShow 触发的时候，监测是否要刷新数据
  refetchOnShow: true
})
```

### InfiniteQuery

比如滑动到底部获取更多数据


```js
// 与 useQuery 不同，此时 data.value 的数据结构为 { pages: T[] }
// fetchNextPage 用来获取下一页
// hasNextPage 代表是否还有下一页
// 其他与 useQuery 相同
const { data, fetchNextPage, hasNextPage, error, isError, isPending, isFetching, isFetchingNextPage } = useInfiniteQuery({
  queryKey: () => ['todos'],
  // pageParam 上一次 getNextPageParam 返回的数据，可以返回任何数据
  // 一般来说，比如无限滚动，返回的可能是对应的 cursor 或者 offset
  // 请求第一页数据的时候，pageParam 为 undefined
  queryFn: async ({ pageParam }) => {
    return fetchTodos({ cursor: pageParam })
  },
  getNextPageParam(lastPage, pages) {
    // 返回 undefined，说明没有更多数据了，hasNextPage 变为 false
    if (lastPage.length === 0) {
      return undefined
    }
    return lastPage[lastPage.length - 1].id
  }
})

// data.pages 为分页数据对应的数据，一般来说，你还需要自己对其进行处理
// 比如说分页数据，第一页返回的是 { data: [1] }，第二页返回的是 { data: [2] }
// 那么 data.pages 为 [{ data: [1] }, { data: [2] }]
// 很多时候，你会想要把其转换为一个数组
const items = computed(() => data.value?.pages?.flatMap(page => page.data) ?? [])

// 触底，请求下一页
onReachBottom(() => {
  fetchNextPage()
})
```

### InfiniteQuery 触发重新获取数据，控制刷新数据的页数

场景：

比如说获取的分页数据过期了，会触发重新刷新分页数据，这个时候，会从第一页开始，依次请求

这样我们可以做到这样的交互逻辑，一个商品列表，下拉加载到第三页，然后对某个 item 执行操作，比如删除，此时重新请求 3 页，用户的界面不会出现明显的跳动，这样交互体验比较好

但如果你的场景一般会加载非常多的分页数据，那么就会发起很多请求，可以通过这个参数控制最多刷新页数，但是超过该页数的数据会丢失

以上面的场景为例子，假设最大页数设置为 5，然后用户刷到第六页去删除一个 item，这个时候只会重新拉 5 页的数据，会造成界面跳动，用户看到的就是第五页，想要看第六页还要再去下滑加载更多

```js
const { ... } = useInfiniteQuery({
  ...
  // 最多刷新 5 页
  maxRefetchPages: 5,
})
```

### 使数据失效

场景：

你更新了一条数据，并且想更新数据，使界面展现最新的数据，使用 invalidateQueries，可以重新获取某个 queryKey 对应的数据

```js
const queryClient = useQueryClient()

async function updateTodo(id) {
  await updateTodoById(id)
  queryClient.invalidateQueries({ queryKey: ['todo', { id } ]})
}
```

### form 场景

> React Query is all about keeping your UI up-to-date with Server State.

这是 TanStack Query 博客中的一句话，你不应该直接去修改 `useQuery` 返回的数据，大多数服务端客户端架构的应用，也不需要

比如说，你调用接口可能会改变服务端状态，你可以调用 `invalidateQueries` 去使客户端缓存失效，从而重新请求获取最新状态

然而，一些场景确实需要客户端去临时修改服务端返回的数据，最典型的场景是表单，你可能需要从服务端获取当前的数据回显到表单上，然后用户可以在表单中进行任意的更改，然后提交表单

这种情况，可以将 `staleTime` 设置为 `Infinity`，`gcTime` 设置为 `0`

比如，

```js
const { data } = useQuery({
  ...,
  staleTime: Infinity,
  gcTime: 0,
})

const formData = ref({
  title: '',
  desc: ''
})

watch(data, (v) => {
  if (v) {
    formData.title = v.title
    formData.desc = v.desc
  }
}, {
  immediate: true,
})
```

这样，formData 只会初始化一次，并且，在组件卸载后，缓存就会失效，下一次再重新挂载组件，会再次发起请求

如果你的这个 `useQuery` 完全只是为了这个页面上的表单使用的而不具备其他复用性，**目前也没有必要去使用 `useQuery`**

你仍然可以使用传统的方式：

```js
onLoad((options) => {
  const initialData = await fetchInitialData(options)
  formData.title = initialData.title
  formData.desc = initialData.desc
})
```

还有一种场景，比如你再界面上点击一个修改弹出弹框进行一些字段的修改，修改保存后重新获取数据，那你可以去保存一下快照，然后去修改快照，保存后 `invalidateQueries`

```js
const { data } = useQuery({
  ...,
  queryKey: ['someDetail'],
})

const editUserInfoPopup = ref(false)
const userInfoSnapshot = ref()

function editUserInfo() {
  userInfoSnapshot.value = cloneDeep(data.user)
  editUserInfoPopup.value = true
}

function saveUserInfo() {
  await updateUserInfo(userInfoSnapshot)
  await queryClient.invalidateQueries({
    queryKey: ['someDetail']
  })
}
```
