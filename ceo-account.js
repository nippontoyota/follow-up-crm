export const CEO_ACCOUNT_DEFINITION = Object.freeze({
  username: 'ceo.nippon',
  name: 'Nippon Toyota CEO',
  role: 'ceo',
  passwordEnv: 'CEO_PASSWORD',
});

export function getCeoPassword() {
  const password = String(process.env[CEO_ACCOUNT_DEFINITION.passwordEnv] || '');
  if (!password) throw new Error('Missing required environment variable CEO_PASSWORD');
  return password;
}
