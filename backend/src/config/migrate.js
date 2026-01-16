'use strict';

const { execSync } = require('child_process');
const path = require('path');

async function runMigrations() {
  try {
    console.log('[Migrate] Running Prisma database sync...');

    // Get the prisma schema path (in the painel root)
    const prismaSchemaPath = path.join(__dirname, '../../../prisma/schema.prisma');

    // Run prisma db push to sync schema with database
    // This creates tables if they don't exist and updates schema
    execSync(`npx prisma db push --schema="${prismaSchemaPath}" --skip-generate`, {
      cwd: path.join(__dirname, '../../..'),
      stdio: 'inherit',
      env: { ...process.env }
    });

    console.log('[Migrate] Database schema synchronized successfully');
    return { success: true, message: 'Schema synchronized' };

  } catch (err) {
    console.error('[Migrate] Prisma sync error:', err.message);
    // Don't fail startup - tables might already exist or be created manually
    return { success: false, error: err.message };
  }
}

module.exports = { runMigrations };

// Run if called directly
if (require.main === module) {
  runMigrations()
    .then(result => {
      console.log('[Migrate] Result:', result);
      process.exit(result.success ? 0 : 1);
    })
    .catch(err => {
      console.error('[Migrate] Fatal error:', err);
      process.exit(1);
    });
}
