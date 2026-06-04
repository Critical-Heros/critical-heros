export const MagicSeparator = '###MAGIC###'

// Deploy target: 'develop' | 'production'. In production the lambdas own ingestion
// + PR review, so the in-process handlers (webhooks, slack ingestion) are disabled.
export const TARGET_ENVIRONMENT = process.env.TARGET_ENVIRONMENT ?? 'develop'
