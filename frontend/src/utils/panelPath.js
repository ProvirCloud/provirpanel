export const ADMIN_BASE_PATH = '/admin'

export const isAdminPath = (pathname = '') => (
  pathname === ADMIN_BASE_PATH || pathname.startsWith(`${ADMIN_BASE_PATH}/`)
)

export const getPanelBasename = () => {
  if (typeof window === 'undefined') return undefined
  return isAdminPath(window.location.pathname) ? ADMIN_BASE_PATH : undefined
}

export const getPanelHref = (path = '/') => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const basename = getPanelBasename() || ''
  return `${basename}${normalizedPath}`
}
