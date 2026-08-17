import '@testing-library/jest-dom'

// Radix UI Select/DropdownMenu 依赖 scrollIntoView（jsdom 未实现），缺失时打开下拉会抛 TypeError
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

// useStickyHeader 依赖 ResizeObserver（jsdom 未实现），缺失时渲染会抛 ReferenceError
if (typeof ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
}
