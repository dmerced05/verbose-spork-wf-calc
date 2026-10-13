// renders the app once on the server to catch runtime crashes without opening a browser
import { renderToString } from 'react-dom/server'
import App from '../src/App'

const html = renderToString(<App />)
console.log(html.includes('Total DPS') ? `render ok (${html.length} chars)` : 'render missing results panel')
