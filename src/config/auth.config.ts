export const authConfig = {
    session: {
      secret: process.env.SESSION_SECRET!,
      cookie: {
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        secure: process.env.NODE_ENV === 'production',
      }
    },
    jwt: {
      secret: process.env.JWT_SECRET!,
      expiresIn: '24h',
    },
    github: {
      clientID: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      callbackURL: `${process.env.API_URL}/auth/github/callback`,
    },
    google: {
      clientID: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      callbackURL: `${process.env.API_URL}/auth/google/callback`,
    }
  };
  