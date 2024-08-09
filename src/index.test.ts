import { test, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import {
  useQuery,
  queryMap,
  infiniteQueryMap,
  useInfiniteQuery,
  hash,
  useQueryClient,
} from '.'
import { defineComponent, onUnmounted, ref } from 'vue'

const onShowListeners = new Set<() => any>()

vi.mock('@dcloudio/uni-app', () => {
  return {
    onShow: (fn: () => any) => {
      onShowListeners.add(fn)
      onUnmounted(() => {
        onShowListeners.delete(fn)
      })
    },
    onLoad: (fn: () => any) => {
      fn()
    },
  }
})

function triggerOnShow() {
  onShowListeners.forEach((fn) => fn())
}

const queryFns = {
  async test() {
    return new Promise<string>((resolve) => {
      setTimeout(() => {
        resolve('test')
      }, 50)
    })
  },
}

test('useQuery', async () => {
  const spy = vi.spyOn(queryFns, 'test')
  const TestComponent = defineComponent({
    setup() {
      return {
        ...useQuery({
          enabled: () => true,
          queryKey: ['test'],
          queryFn: queryFns.test,
        }),
      }
    },
  })
  const TestComponent2 = defineComponent({
    setup() {
      return {
        ...useQuery({
          enabled: () => true,
          queryKey: ['test'],
          queryFn: queryFns.test,
        }),
      }
    },
  })
  const wrapper = mount(TestComponent)
  const wrapper2 = mount(TestComponent2)
  expect(wrapper.vm.isFetching).toBe(true)
  expect(wrapper.vm.isPending).toBe(true)
  expect(wrapper.vm.isError).toBe(false)
  expect(wrapper.vm.isSuccess).toBe(false)
  expect(wrapper.vm.data).toBeUndefined()

  expect(wrapper2.vm.isFetching).toBe(true)
  expect(wrapper2.vm.isPending).toBe(true)
  expect(wrapper2.vm.isError).toBe(false)
  expect(wrapper2.vm.data).toBeUndefined()

  await flushPromises()
  await new Promise((resolve) => {
    setTimeout(resolve, 100)
  })

  // 如果一个接口正在请求中，其他的请求不会再次发起
  expect(spy).toHaveBeenCalledTimes(1)
  expect(wrapper.vm.isFetching).toBe(false)
  expect(wrapper.vm.isSuccess).toBe(true)
  expect(wrapper.vm.data).toBe('test')

  expect(wrapper2.vm.isFetching).toBe(false)
  expect(wrapper2.vm.data).toBe('test')

  // 再挂载一个组件
  const wrapper3 = mount(TestComponent)
  // stale time 为 0，所以会再次请求
  expect(wrapper3.vm.isFetching).toBe(true)
  // 但缓存里还有数据，因此 pending 是 false
  expect(wrapper3.vm.isPending).toBe(false)
  expect(spy).toHaveBeenCalledTimes(2)
  // 这个时候数据也已经有了
  expect(wrapper3.vm.data).toBe('test')
  await flushPromises()
  await new Promise((resolve) => {
    setTimeout(resolve, 100)
  })
  expect(wrapper3.vm.isFetching).toBe(false)
})

test('useQuery error', async () => {
  const queryFns = {
    async test() {
      return new Promise<string>((resolve, reject) => {
        setTimeout(() => {
          reject(new Error('Timeout'))
        }, 50)
      })
    },
  }
  const spy = vi.spyOn(queryFns, 'test')
  const TestComponent = defineComponent({
    setup() {
      return {
        ...useQuery({
          enabled: () => true,
          queryKey: ['testError'],
          queryFn: queryFns.test,
        }),
      }
    },
  })
  const wrapper = mount(TestComponent)
  expect(wrapper.vm.isFetching).toBe(true)
  expect(wrapper.vm.isError).toBe(false)
  await flushPromises()
  await new Promise((resolve) => {
    setTimeout(resolve, 100)
  })
  expect(spy).toHaveBeenCalledTimes(1)
  expect(wrapper.vm.isError).toBe(true)
  expect(wrapper.vm.error?.message).toBe('Timeout')
  spy.mockImplementationOnce(() => {
    return new Promise<string>((resolve) => {
      setTimeout(() => {
        resolve('test')
      }, 50)
    })
  })
  // 这次调用接口能够成功
  const wrapper2 = mount(TestComponent)
  // 当开始调用的时候，isError 会变为 false
  expect(wrapper2.vm.isFetching).toBe(true)
  expect(wrapper2.vm.isPending).toBe(true)
  expect(wrapper2.vm.isError).toBe(false)
  await flushPromises()
  await new Promise((resolve) => {
    setTimeout(resolve, 100)
  })
  expect(spy).toHaveBeenCalledTimes(2)
  expect(wrapper2.vm.isError).toBe(false)
  expect(wrapper2.vm.data).toBe('test')
  // 这个时候，另外组件的数据也会得到刷新
  expect(wrapper.vm.isError).toBe(false)
  expect(wrapper.vm.data).toBe('test')
})

test('useQuery with refetchOnShow enabled', async () => {
  const queryFns = {
    async test() {
      return new Promise<string>((resolve) => {
        setTimeout(() => {
          resolve('test')
        }, 50)
      })
    },
  }
  const spy = vi.spyOn(queryFns, 'test')
  const TestComponent = defineComponent({
    setup() {
      return {
        ...useQuery({
          enabled: () => true,
          queryKey: ['testRefetchOnShow'],
          queryFn: queryFns.test,
          refetchOnShow: true,
        }),
      }
    },
  })
  const wrapper = mount(TestComponent)
  triggerOnShow()
  expect(wrapper.vm.isFetching).toBe(true)
  expect(wrapper.vm.isPending).toBe(true)
  expect(spy).toHaveBeenCalledTimes(1)
  await flushPromises()
  await new Promise((resolve) => {
    setTimeout(resolve, 100)
  })
  expect(wrapper.vm.isFetching).toBe(false)
  expect(wrapper.vm.isPending).toBe(false)
  expect(wrapper.vm.data).toBe('test')
  expect(spy).toHaveBeenCalledTimes(1)
  spy.mockImplementationOnce(() => {
    return new Promise<string>((resolve) => {
      setTimeout(() => {
        resolve('test2')
      })
    })
  })
  triggerOnShow()
  await flushPromises()
  // 重新获取数据
  expect(wrapper.vm.isFetching).toBe(true)
  expect(wrapper.vm.isPending).toBe(false)
  expect(wrapper.vm.data).toBe('test')
  expect(spy).toHaveBeenCalledTimes(2)
  await new Promise((resolve) => {
    setTimeout(resolve, 100)
  })
  // 变为最新数据
  expect(wrapper.vm.isFetching).toBe(false)
  expect(wrapper.vm.isPending).toBe(false)
  expect(wrapper.vm.data).toBe('test2')
  expect(spy).toHaveBeenCalledTimes(2)
})

test('useQuery key changed', async () => {
  const queryFn = vi.fn(() => {
    return new Promise<string>((resolve) => {
      setTimeout(() => {
        resolve('test')
      }, 50)
    })
  })
  const queryKey = ref(['useQueryKeyChanged', 1])
  const TestComponent = defineComponent({
    setup() {
      return {
        ...useQuery({
          enabled: () => true,
          queryKey,
          queryFn,
        }),
      }
    },
  })
  const wrapper = mount(TestComponent)
  expect(wrapper.vm.isFetching).toBe(true)
  expect(wrapper.vm.isPending).toBe(true)
  await flushPromises()
  await new Promise((resolve) => {
    setTimeout(resolve, 100)
  })
  expect(wrapper.vm.isFetching).toBe(false)
  expect(wrapper.vm.data).toBe('test')
  queryFn.mockImplementationOnce(() => {
    return new Promise<string>((resolve) => {
      setTimeout(() => {
        resolve('test2')
      })
    })
  })
  queryKey.value = ['useQueryKeyChanged', 2]
  await flushPromises()
  expect(wrapper.vm.isFetching).toBe(true)
  expect(wrapper.vm.isPending).toBe(true)
  await new Promise((resolve) => {
    setTimeout(resolve, 100)
  })
  expect(wrapper.vm.isFetching).toBe(false)
  expect(wrapper.vm.data).toBe('test2')

  queryFn.mockImplementationOnce(() => {
    return new Promise<string>((resolve) => {
      setTimeout(() => {
        resolve('testNewData')
      })
    })
  })
  // 这个时候将 key 重新设置为原来的值
  queryKey.value = ['useQueryKeyChanged', 1]
  await flushPromises()
  expect(wrapper.vm.isFetching).toBe(true)
  // 因为缓存里还有数据，所以先会从缓存里面取
  expect(wrapper.vm.isPending).toBe(false)
  expect(wrapper.vm.data).toBe('test')
  await new Promise((resolve) => {
    setTimeout(resolve, 100)
  })
  // 请求完成
  expect(wrapper.vm.isFetching).toBe(false)
  expect(wrapper.vm.data).toBe('testNewData')
})

test('useInfiniteQuery', async () => {
  const queryFn = vi.fn(({ pageParam }: { pageParam: number | undefined }) => {
    return new Promise<{ page: number }[]>((resolve) => {
      setTimeout(() => {
        if (!pageParam) {
          resolve([{ page: 1 }])
        } else {
          resolve([{ page: pageParam + 1 }])
        }
      }, 50)
    })
  })

  const TestComponent = defineComponent({
    setup() {
      return {
        ...useInfiniteQuery({
          enabled: () => true,
          queryKey: ['useInfiniteQuery'],
          queryFn,
          getNextPageParam(lastPage) {
            return lastPage[0].page
          },
          maxRefetchPages: 10,
          staleTime: 0,
          refetchOnShow: false,
        }),
      }
    },
  })
  const wrapper = mount(TestComponent)
  expect(wrapper.vm.isFetching).toBe(true)
  expect(wrapper.vm.isPending).toBe(true)
  await flushPromises()
  await new Promise((resolve) => {
    setTimeout(resolve, 100)
  })
  expect(queryFn).toBeCalledTimes(1)
  expect(wrapper.vm.isFetching).toBe(false)
  expect(wrapper.vm.data).toEqual({
    pages: [[{ page: 1 }]],
    pageParams: [undefined],
  })
  wrapper.vm.fetchNextPage()
  expect(wrapper.vm.isFetching).toBe(true)
  expect(wrapper.vm.isPending).toBe(false)
  await flushPromises()
  await new Promise((resolve) => {
    setTimeout(resolve, 100)
  })
  expect(queryFn).toBeCalledTimes(2)
  expect(wrapper.vm.isFetching).toBe(false)
  expect(wrapper.vm.data).toEqual({
    pages: [[{ page: 1 }], [{ page: 2 }]],
    pageParams: [undefined, 1],
  })
  wrapper.vm.fetchNextPage()
  expect(wrapper.vm.isFetching).toBe(true)
  expect(wrapper.vm.isPending).toBe(false)
  await flushPromises()
  await new Promise((resolve) => {
    setTimeout(resolve, 100)
  })
  expect(queryFn).toBeCalledTimes(3)
  expect(wrapper.vm.isFetching).toBe(false)
  expect(wrapper.vm.data).toEqual({
    pages: [[{ page: 1 }], [{ page: 2 }], [{ page: 3 }]],
    pageParams: [undefined, 1, 2],
  })

  // 触发 onShow，此时没有效果
  triggerOnShow()
  await flushPromises()
  expect(queryFn).toBeCalledTimes(3)
  // 此时一个新的组件 mount，会重新请求（因为 staleTime 为 0）
  const wrapper2 = mount(TestComponent)
  // 两个组件，isFetching 都变为 true
  expect(wrapper2.vm.isFetching).toBe(true)
  expect(wrapper.vm.isFetching).toBe(true)

  // TODO: 为什么这里会有 pending
  await new Promise((resolve) => {
    setTimeout(resolve, 500)
  })
  // 全部刷新了一遍
  expect(queryFn).toBeCalledTimes(6)
  expect(wrapper2.vm.data).toEqual({
    pages: [[{ page: 1 }], [{ page: 2 }], [{ page: 3 }]],
    pageParams: [undefined, 1, 2],
  })
})

test('useInfiniteQuery maxRefetchPages', async () => {
  const queryFn = vi.fn(({ pageParam }: { pageParam: number | undefined }) => {
    return new Promise<{ page: number }[]>((resolve) => {
      if (!pageParam) {
        resolve([{ page: 1 }])
      } else {
        resolve([{ page: pageParam + 1 }])
      }
    })
  })

  const TestComponent = defineComponent({
    setup() {
      return {
        ...useInfiniteQuery({
          enabled: () => true,
          queryKey: ['useInfiniteQueryMaxRefetchPages'],
          queryFn,
          getNextPageParam(lastPage) {
            return lastPage[0].page
          },
          maxRefetchPages: 2,
          staleTime: 0,
          refetchOnShow: false,
        }),
      }
    },
  })
  const wrapper = mount(TestComponent)
  await flushPromises()
  wrapper.vm.fetchNextPage()
  await flushPromises()
  wrapper.vm.fetchNextPage()
  await flushPromises()
  expect(wrapper.vm.data).toEqual({
    pages: [[{ page: 1 }], [{ page: 2 }], [{ page: 3 }]],
    pageParams: [undefined, 1, 2],
  })
  // 此时，再 mount 一个组件，刷新数据，但是只会刷新两页，并丢弃最后一页
  const wrapper2 = mount(TestComponent)
  await flushPromises()
  await new Promise((resolve) => {
    setTimeout(resolve, 100)
  })
  expect(wrapper2.vm.data).toEqual({
    pages: [[{ page: 1 }], [{ page: 2 }]],
    pageParams: [undefined, 1],
  })
  // 并且，之前的数据也变成 2 条了
  expect(wrapper.vm.data).toEqual({
    pages: [[{ page: 1 }], [{ page: 2 }]],
    pageParams: [undefined, 1],
  })

  expect(wrapper.vm.isFetching).toBe(false)
  expect(wrapper.vm.isPending).toBe(false)
})

test('useQuery refetchOnShow', async () => {
  const queryFn = vi.fn(({ pageParam }: { pageParam: number | undefined }) => {
    return new Promise<{ page: number }[]>((resolve) => {
      if (!pageParam) {
        resolve([{ page: 1 }])
      } else {
        resolve([{ page: pageParam + 1 }])
      }
    })
  })

  const TestComponent = defineComponent({
    setup() {
      return {
        ...useInfiniteQuery({
          enabled: () => true,
          queryKey: ['useInfiniteQueryRefetchOShow'],
          queryFn,
          getNextPageParam(lastPage) {
            return lastPage[0].page
          },
          maxRefetchPages: Infinity,
          staleTime: 0,
          refetchOnShow: true,
        }),
      }
    },
  })
  const wrapper = mount(TestComponent)
  await flushPromises()
  wrapper.vm.fetchNextPage()
  await flushPromises()
  wrapper.vm.fetchNextPage()
  await flushPromises()

  expect(wrapper.vm.data).toEqual({
    pages: [[{ page: 1 }], [{ page: 2 }], [{ page: 3 }]],
    pageParams: [undefined, 1, 2],
  })
  expect(queryFn).toHaveBeenCalledTimes(3)
  triggerOnShow()
  await new Promise((resolve) => {
    setTimeout(resolve, 100)
  })
  expect(queryFn).toHaveBeenCalledTimes(6)
  expect(wrapper.vm.data).toEqual({
    pages: [[{ page: 1 }], [{ page: 2 }], [{ page: 3 }]],
    pageParams: [undefined, 1, 2],
  })
})

test('useQuery dispose', async () => {
  vi.useFakeTimers()
  const queryFn = vi.fn(() => {
    return new Promise<string>((resolve) => {
      resolve('test')
    })
  })
  const TestComponent = defineComponent({
    setup() {
      return {
        ...useQuery({
          enabled: () => true,
          queryKey: ['useQueryDispose'],
          queryFn,
        }),
      }
    },
  })
  const wrapper = mount(TestComponent)
  await flushPromises()
  expect(wrapper.vm.isFetching).toBe(false)
  expect(wrapper.vm.data).toBe('test')
  expect(queryMap.get(hash(['useQueryDispose']))).toBeDefined()
  wrapper.unmount()
  await flushPromises()
  await vi.runAllTimersAsync()
  expect(queryMap.get(hash(['useQueryDispose']))).toBeUndefined()
  vi.useRealTimers()
})

test('useInfiniteQuery dispose', async () => {
  vi.useFakeTimers()
  const queryFn = vi.fn(({ pageParam }: { pageParam: number | undefined }) => {
    return new Promise<{ page: number }[]>((resolve) => {
      if (!pageParam) {
        resolve([{ page: 1 }])
      } else {
        resolve([{ page: pageParam + 1 }])
      }
    })
  })

  const TestComponent = defineComponent({
    setup() {
      return {
        ...useInfiniteQuery({
          enabled: () => true,
          queryKey: ['useInfiniteQueryDispose'],
          queryFn,
          getNextPageParam(lastPage) {
            return lastPage[0].page
          },
          maxRefetchPages: Infinity,
          staleTime: 0,
          refetchOnShow: true,
        }),
      }
    },
  })
  const wrapper = mount(TestComponent)
  await flushPromises()
  wrapper.vm.fetchNextPage()
  await flushPromises()
  wrapper.vm.fetchNextPage()
  await flushPromises()
  expect(infiniteQueryMap.get(hash(['useInfiniteQueryDispose']))).toBeDefined()
  wrapper.unmount()
  await flushPromises()
  await vi.runAllTimersAsync()
  expect(
    infiniteQueryMap.get(hash(['useInfiniteQueryDispose'])),
  ).toBeUndefined()
  vi.useRealTimers()
})

test('useInfiniteQuery nextParams', async () => {
  const queryFn = vi.fn()
  queryFn.mockImplementationOnce(() => {
    return new Promise<any>((resolve) => {
      resolve({ hasMore: true })
    })
  })
  const TestComponent = defineComponent({
    setup() {
      return {
        ...useInfiniteQuery({
          enabled: () => true,
          queryKey: ['useInfiniteQueryNextParams'],
          queryFn,
          getNextPageParam(lastPage: any) {
            if (lastPage.hasMore) {
              return true
            }
            return undefined
          },
          maxRefetchPages: Infinity,
          staleTime: 0,
        }),
      }
    },
  })
  const wrapper = mount(TestComponent)
  await flushPromises()
  expect(wrapper.vm.data?.pages).toHaveLength(1)
  queryFn.mockImplementationOnce(() => {
    return new Promise<any>((resolve) => {
      resolve({ hasMore: false })
    })
  })
  wrapper.vm.fetchNextPage()
  await flushPromises()
  expect(wrapper.vm.data?.pages).toHaveLength(2)
  expect(wrapper.vm.hasNextPage).toBe(true)
  wrapper.vm.fetchNextPage()
  await flushPromises()
  expect(wrapper.vm.data?.pages).toHaveLength(2)
  expect(wrapper.vm.hasNextPage).toBe(false)
})

test('enabled', async () => {
  const queryFn = vi.fn(() => {
    return new Promise<string>((resolve) => {
      resolve('test')
    })
  })
  const TestComponent = defineComponent({
    setup() {
      return {
        ...useQuery({
          queryKey: ['enabled'],
          queryFn,
        }),
      }
    },
  })
  const wrapper = mount(TestComponent)
  expect(wrapper.vm.isFetching).toBe(true)
  expect(wrapper.vm.isPending).toBe(true)
  expect(queryFn).toHaveBeenCalledTimes(1)
  await flushPromises()
  expect(wrapper.vm.isFetching).toBe(false)
  expect(wrapper.vm.isPending).toBe(false)
  expect(queryFn).toHaveBeenCalledTimes(1)
  expect(wrapper.vm.data).toBe('test')
})

test('reactive enabled', async () => {
  const queryFn = vi.fn(() => {
    return new Promise<string>((resolve) => {
      setTimeout(() => {
        resolve('test')
      }, 0)
    })
  })
  const isEnabled = ref(false)
  const TestComponent = defineComponent({
    setup() {
      return {
        ...useQuery({
          queryKey: ['reactiveEnabled'],
          queryFn,
          enabled: () => isEnabled.value,
        }),
      }
    },
  })
  const wrapper = mount(TestComponent)
  expect(wrapper.vm.isFetching).toBe(false)
  expect(wrapper.vm.isPending).toBe(true)
  expect(queryFn).toHaveBeenCalledTimes(0)
  isEnabled.value = true
  await flushPromises()
  expect(wrapper.vm.isFetching).toBe(true)
  expect(wrapper.vm.isPending).toBe(true)
  expect(queryFn).toHaveBeenCalledTimes(1)
  await new Promise((resolve) => {
    setTimeout(resolve, 100)
  })
  expect(wrapper.vm.isFetching).toBe(false)
  expect(wrapper.vm.isPending).toBe(false)
  expect(queryFn).toHaveBeenCalledTimes(1)
  expect(wrapper.vm.data).toBe('test')
})

test('invalidate queries', async () => {
  const queryClient = useQueryClient()
  const queryFn = vi.fn(() => {
    return new Promise<string>((resolve) => {
      setTimeout(() => {
        resolve('test')
      }, 0)
    })
  })
  const TestComponent = defineComponent({
    setup() {
      return {
        ...useQuery({
          queryKey: ['invalidateQueries'],
          queryFn,
        }),
      }
    },
  })
  const wrapper = mount(TestComponent)
  expect(wrapper.vm.isFetching).toBe(true)
  expect(wrapper.vm.isPending).toBe(true)
  await new Promise((resolve) => {
    setTimeout(resolve, 100)
  })
  expect(wrapper.vm.isFetching).toBe(false)
  expect(wrapper.vm.isPending).toBe(false)
  expect(queryFn).toHaveBeenCalledTimes(1)
  expect(wrapper.vm.data).toBe('test')
  queryFn.mockImplementationOnce(() => {
    return new Promise<string>((resolve) => {
      setTimeout(() => {
        resolve('test2')
      }, 0)
    })
  })
  await queryClient.invalidateQueries({
    queryKey: ['invalidateQueries'],
  })
  expect(wrapper.vm.isFetching).toBe(false)
  expect(wrapper.vm.isPending).toBe(false)
  expect(queryFn).toHaveBeenCalledTimes(2)
  expect(wrapper.vm.data).toBe('test2')
})

test('setQueryData on useQuery', async () => {
  const queryClient = useQueryClient()
  const queryKey = ['setQueryDataOnUseQuery']
  const queryData = { data: 'testData' }
  const queryFn = vi.fn(() => {
    return new Promise<any>((resolve) => {
      resolve(queryData)
    })
  })

  const TestComponent = defineComponent({
    setup() {
      return {
        ...useQuery({
          queryKey,
          queryFn,
        }),
      }
    },
  })

  const wrapper = mount(TestComponent)
  await flushPromises()
  queryClient.setQueryData(['no-exist-key'], (data: any) => {
    return { ...data, data: 'no exist key newData' }
  })
  queryClient.getQueryData(['no-exist-key'])
  expect(wrapper.vm.data).toEqual({ data: 'testData' })

  queryClient.setQueryData(queryKey, (data: any) => {
    return { ...data, data: 'newData' }
  })
  expect(wrapper.vm.data).toEqual({ data: 'newData' })

  queryClient.setQueryData(queryKey, undefined)
  expect(wrapper.vm.data).toEqual({ data: 'newData' })
})

test('setQueryData on useInfiniteQuery', async () => {
  const queryClient = useQueryClient()
  const queryKey = ['setQueryDataOnUseInfiniteQuery']
  const queryFn = vi.fn()
  queryFn.mockImplementationOnce(() => {
    return new Promise<any>((resolve) => {
      resolve({ num: 1 })
    })
  })

  const TestComponent = defineComponent({
    setup() {
      const setQueryDataNewPage = () => {
        queryClient.setQueryData(queryKey, (oldData: any) => {
          const newData = [...oldData, { num: 3 }]
          return newData
        })
      }

      const setQueryDataReplace = () => {
        queryClient.setQueryData(queryKey, [{ num: 999 }])
      }

      const setQueryDataNull = () => {
        queryClient.setQueryData(queryKey, null)
      }

      const undefinedQueryData = () => {
        queryClient.setQueryData(queryKey, undefined)
      }

      const noExistKey = () => {
        queryClient.setQueryData(['no-exist-key'], (data: any) => {
          return { ...data, data: 'no exist key newData' }
        })
      }

      return {
        ...useInfiniteQuery({
          enabled: () => true,
          queryKey: queryKey,
          queryFn,
          getNextPageParam(lastPage: any) {
            if (lastPage.num) {
              return lastPage.num
            }
            return undefined
          },
          maxRefetchPages: Infinity,
          staleTime: 0,
        }),
        setQueryDataNewPage,
        setQueryDataReplace,
        setQueryDataNull,
        undefinedQueryData,
        noExistKey,
      }
    },
  })

  const wrapper = mount(TestComponent)
  await flushPromises()

  expect(wrapper.vm.data?.pages).toHaveLength(1)
  queryFn.mockImplementationOnce(() => {
    return new Promise<any>((resolve) => {
      resolve({ num: 2 })
    })
  })
  wrapper.vm.fetchNextPage()
  await flushPromises()
  expect(wrapper.vm.data?.pages).toHaveLength(2)

  wrapper.vm.noExistKey()
  expect(wrapper.vm.data?.pages).toEqual([{ num: 1 }, { num: 2 }])

  wrapper.vm.undefinedQueryData()
  expect(wrapper.vm.data?.pages).toEqual([{ num: 1 }, { num: 2 }])

  wrapper.vm.setQueryDataNewPage()
  expect(wrapper.vm.data?.pages).toEqual([{ num: 1 }, { num: 2 }, { num: 3 }])

  wrapper.vm.setQueryDataReplace()
  expect(wrapper.vm.data?.pages).toEqual([{ num: 999 }])

  wrapper.vm.undefinedQueryData()
  expect(wrapper.vm.data?.pages).toEqual([{ num: 999 }])

  wrapper.vm.setQueryDataNull()
  expect(wrapper.vm.data?.pages).toEqual([])
})
