import { useState } from 'react';
import './App.css';
import reactLogo from './assets/react.svg';
import { OauthProvider, getTokenStorage } from './lib';

function App() {
  const [count, setCount] = useState(0)
  const [text, setText] = useState<string>('');
  const services = getTokenStorage('123')
  const [savedText, setSavedText] = useState('');


  const saveText = async () => {
    await services.setAccessToken(text);
    setText('');
  }

  const getText = async () => {
    const result = await services.getAccessToken();
    setSavedText(result);
  }

  return (
    <OauthProvider config={(config) => {
      config.clientId = '1234';
      config.authEndpoint = 'http://auth.com';
      config.tokenEndpoint = 'http://token.com';
    }}>
      <div className="App">
        <div>
          <a href="https://vitejs.dev" target="_blank">
            <img src="/vite.svg" className="logo" alt="Vite logo" />
          </a>
          <a href="https://reactjs.org" target="_blank">
            <img src={reactLogo} className="logo react" alt="React logo" />
          </a>
        </div>
        <h1>Vite + React</h1>
        <div className="card">
          <button onClick={() => setCount((count) => count + 1)}>
            count is {count}
          </button>
          <p>
            Edit <code>src/App.tsx</code> and save to test HMR
          </p>
        </div>
        <p className="read-the-docs">
          Click on the Vite and React logos to learn more
        </p>
        <input type='text' value={text} onChange={(e) => setText(e.currentTarget.value)} />
        <button onClick={saveText}>Save</button>
        <button onClick={getText}>Get</button>
        <div>{savedText}</div>
      </div>
    </OauthProvider>
  )
}

export default App
