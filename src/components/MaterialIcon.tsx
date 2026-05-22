import { materialIconFor } from '../lib/materialIcons'

type Props = {
  name: string
  isDir: boolean
  open?: boolean
  className?: string
}

export function MaterialIcon({ name, isDir, open = false, className }: Props) {
  return (
    <img
      src={materialIconFor(name, isDir, open)}
      alt=""
      draggable={false}
      className={className}
    />
  )
}
