export const PUBLISHED_APP_URL = 'https://adscore-keeper.lovable.app';

export const buildExpenseFormUrl = (token: string) => {
  const safeToken = encodeURIComponent(token);
  return `${PUBLISHED_APP_URL}/expense-form/${safeToken}`;
};
