import { useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from './assets/vite.svg'
import heroImg from './assets/hero.png'
import './App.css'

function App() {
  const [count, setCount] = useState(0)

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-900 text-white">
      <div className="rounded-xl bg-gray-800 p-8 shadow-2xl border border-gray-700">
        <h1 className="text-3xl font-bold text-blue-400">
          Parkolóhely Foglaló Rendszer
        </h1>
        <p className="mt-2 text-gray-300">
          A Tailwind CSS v4 sikeresen működik React alatt!
        </p>
      </div>
    </div>
  )
}

export default App
