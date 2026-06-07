import { Navbar } from './components/Navbar'
import { Hero } from './components/Hero'
import { About } from './components/About'
import { Services } from './components/Services'
import { Skills } from './components/Skills'
import { Workflow } from './components/Workflow'
import { Experience } from './components/Experience'
import { Education } from './components/Education'
import { WhyWorkWithMe } from './components/WhyWorkWithMe'
import { Portfolio } from './components/Portfolio'
import { Contact } from './components/Contact'
import { FinalCta } from './components/FinalCta'
import { Footer } from './components/Footer'

function App() {
  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-lavender-700 focus:shadow-lg"
      >
        Skip to main content
      </a>
      <Navbar />
      <main id="main-content" className="flex-1">
        <Hero />
        <About />
        <Services />
        <Skills />
        <Workflow />
        <Experience />
        <Education />
        <WhyWorkWithMe />
        <Portfolio />
        <Contact />
        <FinalCta />
      </main>
      <Footer />
    </div>
  )
}

export default App
