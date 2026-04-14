import type { InputHTMLAttributes } from 'react'

type InputProps = InputHTMLAttributes<HTMLInputElement>

const Input = ({ className = '', ...props }: InputProps) => {
  return <input {...props} className={`zeus-input ${className}`.trim()} />
}

export default Input
