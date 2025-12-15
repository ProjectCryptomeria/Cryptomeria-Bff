import type { Config } from 'drizzle-kit';

export default {
	schema: './src/db/schema.ts',
	out: './drizzle',
	dbCredentials: {
		url: 'sqlite.db',
	},
	dialect:"sqlite"
} satisfies Config;