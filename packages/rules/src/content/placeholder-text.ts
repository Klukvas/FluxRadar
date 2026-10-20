// Verified against official WordPress language packs, admin-*.mo (6.8 and 6.0):
// https://translate.wordpress.org/projects/wp/dev/admin/uk/default/
// https://translate.wordpress.org/projects/wp/dev/admin/ru/default/
// https://downloads.wordpress.org/translation/core/6.8/uk.zip
// https://downloads.wordpress.org/translation/core/6.8/ru_RU.zip
export const PLACEHOLDER_PATTERNS = [
  { id: 'lorem-body', text: 'lorem ipsum dolor', headingOnly: false },
  { id: 'lorem-heading', text: 'lorem ipsum', headingOnly: true },
  ...[
    'Just another WordPress site',
    'Просто ще один сайт на WordPress',
    'Ещё один сайт на WordPress',
  ].map((text) => ({ id: 'wordpress-tagline', text, headingOnly: false })),
  ...['Sample Page', 'Зразок сторінки', 'Пример страницы'].map((text) => ({
    id: 'wordpress-sample-page',
    text,
    headingOnly: true,
  })),
  ...['Hello world!', 'Привіт, світ!', 'Привет, мир!'].map((text) => ({
    id: 'wordpress-hello-world',
    text,
    headingOnly: true,
  })),
] as const;
