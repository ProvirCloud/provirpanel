import React from 'react'
import NginxVisualEditor from './NginxVisualEditor'

/**
 * Test page for NginxVisualEditor - no authentication required
 * Access at: http://localhost:5174/nginx-visual-test
 */
export default function NginxVisualEditorTest() {
  return (
    <div style={{ width: '100vw', height: '100vh', margin: 0, padding: 0 }}>
      <NginxVisualEditor />
    </div>
  )
}
