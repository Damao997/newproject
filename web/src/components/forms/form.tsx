import { FormErrorSummary } from './error-summary'
import { createContext, useContext, useEffect, useId, useRef, type ReactNode, type RefCallback } from 'react'
import { Controller, FormProvider, useForm, type Control, type FieldValues, type Path, type UseFormProps, type UseFormReturn } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { Input, type InputProps } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AlertCircle, HelpCircle } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

const FieldContext = createContext<{ id: string; descriptionId?: string; invalid: boolean } | null>(null)
export const useFormFieldContext = () => useContext(FieldContext)

/** 表单值保持编辑态；金额等业务转换由提交映射负责，避免把空串转换为零。 */
export function useAppForm<T extends FieldValues>(schema: z.ZodType<T>, options: Omit<UseFormProps<T>, 'resolver'> = {}) {
  return useForm<T>({ mode: 'onBlur', reValidateMode: 'onChange', ...options, resolver: zodResolver(schema) })
}

export function AppForm<T extends FieldValues>({ form, children, onSubmit, id, className }: {
  form: UseFormReturn<T>; children: ReactNode; onSubmit: (values: T) => Promise<void> | void; id?: string; className?: string
}) {
  const submitLock = useRef(false)
  return <FormProvider {...form}><form id={id} noValidate className={cn('saas-form space-y-6', className)}
    onSubmit={(event) => {
      event.preventDefault()
      if (submitLock.current) return
      submitLock.current = true
      void form.handleSubmit(onSubmit)(event).finally(() => { submitLock.current = false })
    }}
    onKeyDown={(event) => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault() }}>
    <FormErrorSummary form={form} visible={form.formState.submitCount > 0} />
    <fieldset disabled={form.formState.isSubmitting} className="m-0 min-w-0 space-y-6 border-0 p-0">{children}</fieldset>
  </form></FormProvider>
}

export function FormSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <section className="form-section space-y-4"><div className="space-y-1">
    <h3 className="text-base font-semibold">{title}</h3>
    {description && <p className="text-sm text-muted-foreground">{description}</p>}
  </div>{children}</section>
}

export function FormField<T extends FieldValues>({ control, name, label, required, hint, help, children }: {
  control: Control<T>; name: Path<T>; label: string; required?: boolean; hint?: ReactNode; help?: string;
  children: (props: { value: T[Path<T>]; onChange: (...event: unknown[]) => void; onBlur: () => void; name: string; ref: RefCallback<{ focus: () => void }>; id: string; 'aria-invalid': boolean; 'aria-describedby'?: string }) => ReactNode
}) {
  const generated = useId()
  const id = `field-${generated.replace(/:/g, '')}`
  return <Controller control={control} name={name} render={({ field, fieldState }) => {
    const descriptionId = hint || fieldState.error ? `${id}-message` : undefined
    return <FieldContext.Provider value={{ id, descriptionId, invalid: !!fieldState.error }}>
      <div className="form-field space-y-2">
        <div className="flex items-center gap-2"><Label htmlFor={id}>{label}
          {required && <span className="ml-1 text-danger" aria-label="必填">*</span>}
        </Label>{help && <Popover><PopoverTrigger asChild><button type="button" aria-label={`${label}说明`}
          className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <HelpCircle className="h-4 w-4" /></button></PopoverTrigger>
          <PopoverContent className="max-w-[min(320px,calc(100vw-32px))] text-sm">{help}</PopoverContent></Popover>}</div>
        {children({ ...field, id, 'aria-invalid': !!fieldState.error, 'aria-describedby': descriptionId })}
        {(hint || fieldState.error) && <div id={descriptionId} className="min-h-5 text-xs leading-5">
          {fieldState.error ? <p className="flex items-start gap-1.5 text-danger"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{fieldState.error.message}</p>
            : <p className="text-muted-foreground">{hint}</p>}
        </div>}
      </div>
    </FieldContext.Provider>
  }} />
}

export function FormInput<T extends FieldValues>({ control, name, label, required, hint, help, ...props }:
  { control: Control<T>; name: Path<T>; label: string; required?: boolean; hint?: ReactNode; help?: string } & InputProps) {
  return <FormField control={control} name={name} label={label} required={required} hint={hint} help={help}>
    {(field) => <Input {...props} {...field} value={String(field.value ?? '')} className={cn('h-11', props.className)} />}
  </FormField>
}

export function FormError({ message }: { message?: string | null }) {
  const region = useRef<HTMLDivElement>(null)
  useEffect(() => { if (message) region.current?.scrollIntoView?.({ block: 'nearest' }) }, [message])
  return message ? <div ref={region} role="alert" className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
    <span className="flex items-start gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{message}</span>
  </div> : null
}
