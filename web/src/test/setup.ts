import '@testing-library/jest-dom'

// Radix UI Select/DropdownMenu 依赖 scrollIntoView（jsdom 未实现），缺失时打开下拉会抛 TypeError
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}
