import type { InputHTMLAttributes } from 'react'

type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label?: string
}

const Checkbox = ({ label, className = '', ...props }: CheckboxProps) => {
  return (
    <label className={`inline-flex items-center gap-3 text-sm text-[var(--color-text-muted)] ${className}`.trim()}>
      <input
        {...props}
        type="checkbox"
        className="h-4 w-4 rounded border-[var(--color-border)] bg-[var(--input-bg)] text-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-focus-ring)]"
      />
      {label ? <span>{label}</span> : null}
    </label>
  )
}

export default Checkbox
