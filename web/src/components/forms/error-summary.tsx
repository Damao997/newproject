import type { FieldErrors, FieldValues, Path, UseFormReturn } from 'react-hook-form'

function collect(errors: FieldErrors, prefix = ''): { path: string; message: string }[] {
  return Object.entries(errors).flatMap(([name, value]) => {
    if (!value || name === 'root' || name === 'ref') return []
    const path = prefix ? prefix + '.' + name : name
    if (typeof value === 'object' && 'message' in value && typeof value.message === 'string') return [{ path, message: value.message }]
    return typeof value === 'object' ? collect(value as FieldErrors, path) : []
  })
}
/** 提交后汇总字段错误，按键可直接返回对应输入。服务端错误保持独立。 */
export function FormErrorSummary<T extends FieldValues>({ form, visible }: { form: UseFormReturn<T>; visible: boolean }) {
  const errors = visible ? collect(form.formState.errors) : []
  if (!errors.length) return null
  return <div role="alert" className="rounded-xl border border-danger/25 bg-danger/5 p-3 text-sm">
    <p className="mb-1 font-medium text-danger">请检查 {errors.length} 项内容</p>
    <ul className="space-y-1">{errors.map(({ path, message }) => <li key={path}>
      <button type="button" className="text-left text-danger underline decoration-danger/40 underline-offset-4" onClick={() => {
        form.setFocus(path as Path<T>)
        document.activeElement?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
      }}>{message}</button>
    </li>)}</ul>
  </div>
}
