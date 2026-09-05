import Document, { Html, Head, Main, NextScript } from 'next/document';

/**
 * Custom Document to correctly use Next.js's <Html> component.
 * This file replaces any direct import of <Html> inside regular page
 * components, which violates Next.js's rule "no-document-import-in-page".
 */
export default class MyDocument extends Document {
  render() {
    return (
      <Html lang="en">
        <Head>
          {/* Add any global meta tags, fonts, or scripts here */}
        </Head>
        <body>
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }
}
