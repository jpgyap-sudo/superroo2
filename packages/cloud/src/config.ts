export const PRODUCTION_CLERK_BASE_URL = "https://clerk.superroo.com"
export const PRODUCTION_SUPERROO_API_URL = "https://app.superroo.com"

export const getClerkBaseUrl = () => process.env.CLERK_BASE_URL || PRODUCTION_CLERK_BASE_URL

export const getSuperRooApiUrl = () => process.env.SUPERROO_API_URL || PRODUCTION_SUPERROO_API_URL
