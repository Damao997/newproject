import { FormErrorSummary } from './error-summary'
import { createContext, useCallback, useContext, useRef, useState, type ReactNode, type RefCallback } from 'react'
import { Controller, useForm, type FieldValues, type Path, type PathValue } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import type { Dispatch, SetStateAction } from 'react'

export function useFormModel<T extends FieldValues>(initial: T, required: Partial<Record<keyof T, string>> = {}, explicitSchema?: z.ZodType<T>) {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const [name, value] of Object.entries(initial)) {
    if (typeof value === 'string') shape[name] = required[name] ? z.string().refine((text) => !!text.trim(), required[name]) : z.string()
    else if (typeof value === 'boolean') shape[name] = z.boolean()
    else if (typeof value === 'number') shape[name] = z.number()
    else if (value instanceof Set) shape[name] = z.set(z.string())
    else if (Array.isArray(value)) shape[name] = required[name] ? z.array(z.string()).min(1, required[name]) : z.array(z.string())
    else throw new Error(`表单字段 ${name} 需要明确的校验类型`)
  }
  // schema 字段和默认值逐项同源；业务联合类型仍由调用方维护。
  const schema = explicitSchema ?? z.object(shape) as unknown as z.ZodType<T>
  const form = useForm<T>({ defaultValues: initial as import('react-hook-form').DefaultValues<T>, resolver: zodResolver(schema), mode: 'onBlur', reValidateMode: 'onChange' })
  const validationAttempted = useRef(false)
  const submitLock = useRef(false)
  const [pending, setPending] = useState(false)
  const values = form.watch()
  const setValues = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    if (typeof next !== 'function') { validationAttempted.current = false; form.reset(next); return }
    const updated = next(form.getValues())
    for (const name of Object.keys(updated)) {
      const path = name as Path<T>
      if (updated[name] !== form.getValues(path)) form.setValue(path, updated[name] as PathValue<T, typeof path>, { shouldDirty: true, shouldValidate: validationAttempted.current || form.getFieldState(path).isTouched })
    }
  }, [form])
  const validate = () => { validationAttempted.current = true; return form.trigger(undefined, { shouldFocus: true }) }
  const submit = (handler: () => Promise<void>, validateFields = true) => async () => {
    if (submitLock.current) return
    submitLock.current = true
    try { if (!validateFields || await validate()) { setPending(true); await handler() } } finally { submitLock.current = false; setPending(false) }
  }
  return { form, values, setValues, validationAttempted, validate, pending, submit }
}

export function useFormValue<T extends FieldValues, K extends keyof T & string>(model: ReturnType<typeof useFormModel<T>>, name: K): [T[K], Dispatch<SetStateAction<T[K]>>] {
  const setter = useCallback<Dispatch<SetStateAction<T[K]>>>((next) => {
    const current = model.form.getValues()[name]
    const updated = typeof next === 'function' ? (next as (previous: T[K]) => T[K])(current) : next
    model.form.setValue(name as unknown as Path<T>, updated as PathValue<T, Path<T>>, { shouldDirty: true, shouldValidate: model.validationAttempted.current || model.form.getFieldState(name as unknown as Path<T>).isTouched })
  }, [model.form, model.validationAttempted, name])
  return [model.values[name], setter]
}

type FieldBinding = { value: unknown; name: string; onBlur: () => void; ref: RefCallback<{ focus: () => void }>; invalid: boolean; disabled: boolean; message?: string }
type Adapter = { render: (name: string, children: (field: FieldBinding) => ReactNode) => ReactNode }
const AdapterContext = createContext<Adapter | null>(null)

export function ModelFormFields<T extends FieldValues>({ model, children }: { model: ReturnType<typeof useFormModel<T>>; children: ReactNode }) {
  const adapter: Adapter = { render: (name, render) => <Controller control={model.form.control} name={name as Path<T>} render={({ field, fieldState }) =>
    <>{render({ value: field.value, name, onBlur: field.onBlur, ref: field.ref, invalid: !!fieldState.error, disabled: model.pending, message: fieldState.error?.message })}</>} /> }
  return <AdapterContext.Provider value={adapter}><FormErrorSummary form={model.form} visible={model.validationAttempted.current} /><fieldset disabled={model.pending} className="m-0 min-w-0 space-y-4 border-0 p-0">{children}</fieldset>
    {model.form.formState.errors.root?.message && <div role="alert" className="rounded-md border border-danger/20 bg-danger/10 p-3 text-sm text-danger">{String(model.form.formState.errors.root.message)}</div>}
  </AdapterContext.Provider>
}
export const useModelAdapter = () => useContext(AdapterContext)

export function useFormSet<T extends FieldValues, K extends keyof T & string>(model: ReturnType<typeof useFormModel<T>>, name: K): [Set<string>, Dispatch<SetStateAction<Set<string>>>] {
  const [value, setValue] = useFormValue(model, name)
  const selected = new Set<string>(Array.isArray(value) ? value : [])
  const setter: Dispatch<SetStateAction<Set<string>>> = (next) => {
    const current = new Set<string>(model.form.getValues()[name] as string[])
    const updated = typeof next === 'function' ? next(current) : next
    setValue([...updated] as T[K])
  }
  return [selected, setter]
}
