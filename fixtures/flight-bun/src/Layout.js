import * as React from 'react';

/**
 * Layout — Server Component
 *
 * Provides the full HTML document shell (html, head, body) with a nested
 * layout structure containing a header, sidebar navigation, and main
 * content area.  App.js wraps its content inside this component so that
 * every page shares a consistent chrome.
 *
 * This is a Server Component (not a Client Component).
 */
export default function Layout({children}) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Flight on Bun</title>
      </head>
      <body>
        <div id="root">
          <header data-testid="layout-header">
            <h1>Flight on Bun</h1>
          </header>
          <div style={{display: 'flex'}}>
            <aside
              data-testid="layout-sidebar"
              style={{width: '200px', padding: '10px'}}>
              <nav>
                <ul>
                  <li>Home</li>
                  <li>About</li>
                </ul>
              </nav>
            </aside>
            <main
              data-testid="layout-content"
              style={{flex: 1, padding: '10px'}}>
              {children}
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
