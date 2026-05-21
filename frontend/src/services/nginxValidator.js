/**
 * Nginx Configuration Validator
 * Provides syntax validation and linting for nginx config files
 */

/**
 * Basic nginx syntax rules for client-side validation
 * Note: Full validation should be done server-side with actual nginx parser
 */
const NGINX_KEYWORDS = [
  'server', 'location', 'upstream', 'http', 'events', 'stream',
  'if', 'rewrite', 'map', 'geo', 'types', 'ssl_certificate',
  'ssl_certificate_key', 'listen', 'server_name', 'proxy_pass',
  'proxy_set_header', 'add_header', 'return', 'try_files'
]

const validateNginxSyntax = (configContent) => {
  const errors = []
  const warnings = []
  const lines = configContent.split('\n')

  let braceCount = 0
  let bracketCount = 0

  lines.forEach((line, idx) => {
    const lineNum = idx + 1
    const trimmed = line.trim()

    // Skip comments and empty lines
    if (trimmed.startsWith('#') || !trimmed) return

    // Check braces balance
    braceCount += (line.match(/{/g) || []).length
    braceCount -= (line.match(/}/g) || []).length
    bracketCount += (line.match(/\[/g) || []).length
    bracketCount -= (line.match(/]/g) || []).length

    // Check for missing semicolons (simplified)
    if (trimmed && !trimmed.endsWith(';') && !trimmed.endsWith('{') && !trimmed.endsWith('}')) {
      if (!trimmed.includes('{') && !trimmed.includes('#')) {
        warnings.push({
          line: lineNum,
          message: 'Possible missing semicolon',
          severity: 'warning'
        })
      }
    }

    // Check for common mistakes
    if (trimmed.includes('proxy_pass') && !trimmed.includes('http://') && !trimmed.includes('https://') && !trimmed.includes('$')) {
      errors.push({
        line: lineNum,
        message: 'proxy_pass should be http://, https://, or a variable',
        severity: 'error'
      })
    }

    // Check for deprecated directives
    if (trimmed.includes('ssl on;')) {
      warnings.push({
        line: lineNum,
        message: 'Deprecated: use "listen ... ssl" instead of "ssl on"',
        severity: 'warning'
      })
    }

    // Check for security headers
    if (trimmed.includes('X-Frame-Options') && !trimmed.includes('SAMEORIGIN') && !trimmed.includes('DENY')) {
      warnings.push({
        line: lineNum,
        message: 'X-Frame-Options should be SAMEORIGIN or DENY for security',
        severity: 'warning'
      })
    }
  })

  // Check unmatched braces
  if (braceCount !== 0) {
    errors.push({
      line: -1,
      message: `Unmatched braces: ${braceCount > 0 ? braceCount + ' opening' : Math.abs(braceCount) + ' closing'} braces`,
      severity: 'error'
    })
  }

  if (bracketCount !== 0) {
    errors.push({
      line: -1,
      message: `Unmatched brackets: ${bracketCount > 0 ? bracketCount + ' opening' : Math.abs(bracketCount) + ' closing'} brackets`,
      severity: 'error'
    })
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    hasIssues: errors.length > 0 || warnings.length > 0
  }
}

/**
 * Server-side validation - call backend to validate with actual nginx parser
 */
export const validateNginxConfigRemote = async (configContent, siteName) => {
  try {
    const response = await fetch('/api/nginx/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: configContent, site: siteName })
    })
    const data = await response.json()
    return {
      valid: data.valid || true,
      errors: data.errors || [],
      warnings: data.warnings || [],
      hasIssues: (data.errors || []).length > 0 || (data.warnings || []).length > 0
    }
  } catch (error) {
    console.error('Remote validation failed:', error)
    // Fall back to client-side validation
    return validateNginxSyntax(configContent)
  }
}

export const validateNginxSyntaxClient = validateNginxSyntax

export default {
  validateNginxSyntax,
  validateNginxConfigRemote
}
