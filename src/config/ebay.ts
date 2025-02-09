type EbayEnvironment = 'SANDBOX' | 'PRODUCTION';
export const ebayConfig = {
  apiUrl: 'https://api.ebay.com/buy/browse/v1',
  authUrl: 'https://api.ebay.com/identity/v1/oauth2/token',
  sandbox: {
    apiUrl: 'https://api.sandbox.ebay.com/buy/browse/v1',
    authUrl: 'https://api.sandbox.ebay.com/identity/v1/oauth2/token',
  },
  credentials: {
    clientId: process.env.EBAY_CLIENT_ID,
    clientSecret: process.env.EBAY_CLIENT_SECRET,
    devid: process.env.EBAY_DEV_ID,
    redirectUri: process.env.EBAY_REDIRECT_URI,
    baseUrl: process.env.EBAY_BASE_URL,
  },
  defaultLimit: 15,
  conditionMap: {
    'new': '1000',
    'openBox': '1500',
    'used': '3000'
  },
  tokenExpiryBuffer: 300, // 5 minutes buffer before actual expiry
  environment: (process.env.NODE_ENV === 'production' ? 'PRODUCTION' : 'SANDBOX') as EbayEnvironment,
};
