import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import styles from './FormField.module.css'

export interface FormFieldProps {
  label: string
  htmlFor: string
  hint?: string
  error?: string
  children: ReactNode
}

interface DescribedControlProps {
  'aria-describedby'?: string
  'aria-invalid'?: boolean | 'true' | 'false'
}

/** Label + control + accessible supporting/error text. */
export function FormField({ label, htmlFor, hint, error, children }: FormFieldProps) {
  const hintId = hint ? `${htmlFor}-hint` : undefined
  const errorId = error ? `${htmlFor}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined

  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<DescribedControlProps>, {
        'aria-describedby': [
          (children.props as DescribedControlProps)['aria-describedby'],
          describedBy,
        ]
          .filter(Boolean)
          .join(' ') || undefined,
        'aria-invalid': error
          ? true
          : (children.props as DescribedControlProps)['aria-invalid'],
      })
    : children

  return (
    <div className={styles.field}>
      <label htmlFor={htmlFor} className={styles.label}>
        {label}
      </label>
      {control}
      {hint && (
        <span id={hintId} className={styles.hint}>
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} className={styles.error} role="alert">
          {error}
        </span>
      )}
    </div>
  )
}
