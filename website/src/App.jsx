import React, { useState } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Check, ChevronDown, Command, FileArchive, FileAudio, FileImage, FileText, Folder, Github, HardDrive, LockKeyhole, Menu, MonitorDown, ShieldCheck, Workflow, X } from 'lucide-react';

const GITHUB = 'https://github.com/marazinaburahman-design/AutoCompress';
const RELEASE = 'https://github.com/marazinaburahman-design/AutoCompress/releases/latest';

const questions = [
  ['Does AutoCompress upload my files?', 'No. AutoCompress processes supported files locally on your Windows computer. Your files are not sent to a cloud converter.'],
  ['Will it overwrite my original files?', 'No. Processed results are written separately. Your original source files are preserved.'],
  ['Which operating systems are supported?', 'The current release targets Windows 10 and Windows 11, 64-bit. A macOS version is not currently available.'],
  ['Can it watch folders automatically?', 'Yes. Configure watched folders and automation rules. AutoCompress waits for files to finish copying and excludes configured output folders to prevent recursive processing.'],
  ['Does it convert every file type?', 'No. Support depends on the processor. Images can be converted between supported formats; ZIP, PDF, WAV, MP4 and Office files have format-specific processing limits.'],
  ['Is the Windows installer signed?', 'The current installer is unsigned, so Windows SmartScreen may show a warning.']
];

const fileTypes = [
  { icon: FileImage, name: 'Images', formats: 'PNG · JPEG · WebP · AVIF · TIFF · BMP', note: 'Convert, optimize and resize supported images.' },
  { icon: FileArchive, name: 'Archives', formats: 'ZIP', note: 'Recompress existing archives; extraction is not included.' },
  { icon: FileText, name: 'Documents', formats: 'PDF · DOCX · XLSX · PPTX', note: 'Validate and reserialize supported documents.' },
  { icon: FileAudio, name: 'Media', formats: 'WAV · MP4', note: 'Format-specific audio processing and metadata layout optimization.' }
];

function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState(0);
  const nav = [['Product', '#product'], ['Workflow', '#workflow'], ['Formats', '#formats'], ['FAQ', '#faq']];

  return <div className="site-shell">
    <a className="skip-link" href="#main">Skip to content</a>
    <div className="topline"><span className="topline-mark" /> A WINDOWS DESKTOP TOOL FOR THE FILES THAT KEEP PILING UP <a href={RELEASE}>Release 0.1.0 <ArrowUpRight size={13}/></a></div>
    <header className="site-header">
      <a className="wordmark" href="#" aria-label="AutoCompress home"><span className="wordmark-icon"><Command size={19}/></span><span>auto<span>compress</span></span></a>
      <nav className={menuOpen ? 'main-nav is-open' : 'main-nav'} aria-label="Main navigation">
        {nav.map(([label, href]) => <a key={href} href={href} onClick={() => setMenuOpen(false)}>{label}</a>)}
        <a href={GITHUB} target="_blank" rel="noreferrer">Source <ArrowUpRight size={13}/></a>
      </nav>
      <a className="header-action" href={RELEASE} target="_blank" rel="noreferrer">Get AutoCompress <ArrowUpRight size={15}/></a>
      <button className="menu-toggle" onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen}>{menuOpen ? <X/> : <Menu/>}</button>
    </header>

    <main id="main">
      <section className="hero" id="product">
        <div className="hero-copy">
          <div className="kicker"><span>01</span> THE DESKTOP FILE WORKFLOW</div>
          <h1>Make room<br/>for <em>the work.</em></h1>
          <p className="hero-lede">A Windows desktop assistant that watches your folders and takes care of supported file-processing tasks in the background. Your files stay on your machine. Your originals stay untouched.</p>
          <div className="hero-buttons">
            <a className="btn btn-primary" href={RELEASE} target="_blank" rel="noreferrer"><MonitorDown size={17}/> View Windows release <ArrowUpRight size={15}/></a>
            <a className="btn btn-secondary" href={GITHUB} target="_blank" rel="noreferrer"><Github size={17}/> Explore the source</a>
          </div>
          <div className="hero-proof"><span><Check size={14}/> Local processing</span><span><Check size={14}/> Separate output files</span><span><Check size={14}/> Windows 10/11 x64</span></div>
        </div>
        <div className="hero-stage" aria-label="Illustration of AutoCompress processing files from an incoming folder to an output folder">
          <div className="stage-label"><span>FILE ROUTING / 001</span><span>LOCAL MACHINE ONLY</span></div>
          <div className="flow-board">
            <div className="flow-top"><span className="window-lights"><i/><i/><i/></span><span>AutoCompress / Workspace</span><span className="online"><i/> WATCHING</span></div>
            <div className="flow-content">
              <div className="flow-column">
                <span className="flow-overline">SOURCE</span>
                <div className="folder-illustration"><Folder size={37}/><b>Incoming</b><small>3 new files</small></div>
                <div className="file-chip"><FileImage/><span>product-shot.png<small>PNG · 4.8 MB</small></span></div>
                <div className="file-chip"><FileArchive/><span>assets-pack.zip<small>ZIP · 18.2 MB</small></span></div>
                <div className="file-chip"><FileText/><span>brief.pdf<small>PDF · 1.2 MB</small></span></div>
              </div>
              <div className="flow-connector"><span className="connector-line"/><span className="connector-node"><ArrowRight size={17}/></span><small>RULES</small><span className="connector-line"/></div>
              <div className="flow-column output-column">
                <span className="flow-overline">RESULT</span>
                <div className="folder-illustration output-folder"><Folder size={37}/><b>Processed</b><small>Separate destination</small></div>
                <div className="result-row"><span className="result-check"><Check size={13}/></span><span>product-shot.webp<small>Optimized image</small></span></div>
                <div className="result-row"><span className="result-check"><Check size={13}/></span><span>assets-pack.zip<small>Archive recompressed</small></span></div>
                <div className="result-row"><span className="result-check"><Check size={13}/></span><span>brief.pdf<small>Document processed</small></span></div>
              </div>
            </div>
            <div className="flow-bottom"><span><span className="pulse"/> Folder monitoring active</span><span>Originals remain in source</span></div>
          </div>
          <div className="stage-caption"><LockKeyhole size={14}/> No cloud upload. No source-file overwrite.</div>
        </div>
        <div className="hero-index"><span>01 / 04</span><span>LESS MANUAL FILE WORK</span><ArrowDownRight size={19}/></div>
      </section>

      <section className="manifesto section-pad">
        <div className="section-number">A BETTER KIND OF BACKGROUND TASK</div>
        <div className="manifesto-copy"><h2>Files come in.<br/><span>Busywork goes out.</span></h2><p>Downloads, project assets, documents and media all need attention. AutoCompress gives supported file tasks a predictable place to happen — quietly, locally, and on rules you control.</p></div>
        <div className="manifesto-side"><Workflow size={25}/><span>WATCH</span><i/><span>PROCESS</span><i/><span>REVIEW</span></div>
      </section>

      <section className="product-section section-pad">
        <div className="section-head"><div><div className="section-number">WHAT IT DOES</div><h2>Small operations.<br/><span>Less interruption.</span></h2></div><p>Designed around the everyday work of keeping files ready, lighter and organized.</p></div>
        <div className="capability-list">
          <article className="capability capability-featured"><div className="cap-number">01</div><div className="cap-icon"><Folder/></div><div className="cap-copy"><h3>Watch the folders you choose</h3><p>AutoCompress detects new files, waits for copying to finish and processes supported files according to your configured rules.</p></div><div className="cap-visual"><div className="mini-path"><Folder size={17}/><span>Incoming files</span><ArrowRight size={15}/><span className="path-result">Processed output</span></div><small>YOUR FOLDERS. YOUR DESTINATION.</small></div></article>
          <article className="capability"><div className="cap-number">02</div><div className="cap-icon"><ShieldCheck/></div><div className="cap-copy"><h3>Keep the originals</h3><p>Results are written separately with collision-safe names. The source file is not overwritten.</p></div></article>
          <article className="capability"><div className="cap-number">03</div><div className="cap-icon"><HardDrive/></div><div className="cap-copy"><h3>Keep processing local</h3><p>Files are processed on your Windows computer, not uploaded to an online conversion service.</p></div></article>
          <article className="capability"><div className="cap-number">04</div><div className="cap-icon"><Workflow/></div><div className="cap-copy"><h3>Make the rules yours</h3><p>Configure watched folders and automation rules, then pause or resume monitoring when needed.</p></div></article>
        </div>
      </section>

      <section className="workflow-section section-pad" id="workflow">
        <div className="section-head"><div><div className="section-number">A SIMPLE ROUTINE</div><h2>Set the route.<br/><span>Get on with your day.</span></h2></div><p>Four clear steps. No account or cloud workspace required for the core workflow.</p></div>
        <div className="workflow-steps">
          {[
            ['01','Choose a source','Select the folder AutoCompress should watch.'],
            ['02','Choose your rules','Set the processing behavior for supported file types.'],
            ['03','Let files arrive','The watcher waits until a file has finished copying.'],
            ['04','Review the result','Find processed files in the separate output folder and check job history.']
          ].map(([n,t,d])=><article className="workflow-step" key={n}><span className="step-index">{n}</span><div className="step-rule"/><h3>{t}</h3><p>{d}</p></article>)}
        </div>
      </section>

      <section className="formats-section section-pad" id="formats">
        <div className="section-head"><div><div className="section-number">FORMAT SUPPORT</div><h2>Know what each<br/><span>file can do.</span></h2></div><p>Not every format is processed the same way. Capabilities depend on the file type and its processor.</p></div>
        <div className="format-table">
          {fileTypes.map(({icon: Icon,name,formats,note},i)=><article className="format-line" key={name}><span className="format-count">0{i+1}</span><span className="format-icon"><Icon size={20}/></span><div className="format-info"><h3>{name}</h3><p>{formats}</p><small>{note}</small></div><ArrowUpRight className="format-arrow" size={17}/></article>)}
        </div>
        <a className="underlined-link" href={GITHUB+'/blob/main/SUPPORTED_FORMATS.md'} target="_blank" rel="noreferrer">Read the full format matrix and limitations <ArrowUpRight size={15}/></a>
      </section>

      <section className="privacy-section">
        <div className="privacy-inner section-pad"><div className="privacy-seal"><div className="seal-ring"><LockKeyhole size={39}/></div><span>LOCAL BY DESIGN</span><small>YOUR DEVICE / YOUR FILES</small></div><div className="privacy-copy"><div className="section-number">A CLEAR BOUNDARY</div><h2>Your files don't<br/><span>need a detour.</span></h2><p>AutoCompress is built as a local-first desktop application. Supported processing happens on your computer, and results are saved to the destination you configure. No account or cloud storage is needed for the core workflow.</p><a className="underlined-link" href={GITHUB+'/blob/main/SECURITY.md'} target="_blank" rel="noreferrer">Read the security notes <ArrowUpRight size={15}/></a></div></div>
      </section>

      <section className="faq-section section-pad" id="faq">
        <div className="faq-heading"><div className="section-number">BEFORE YOU INSTALL</div><h2>Good questions.<br/><span>Clear answers.</span></h2><p>For technical details, check the guides and implementation notes in the repository.</p><a className="underlined-link" href={GITHUB} target="_blank" rel="noreferrer">Browse project documentation <ArrowUpRight size={15}/></a></div>
        <div className="faq-list">{questions.map(([q,a],i)=><article className={openFaq===i?'faq-item expanded':'faq-item'} key={q}><h3><button onClick={()=>setOpenFaq(openFaq===i?-1:i)} aria-expanded={openFaq===i}>{q}<ChevronDown size={18}/></button></h3>{openFaq===i&&<p>{a}</p>}</article>)}</div>
      </section>

      <section className="closing-section"><div className="closing-inner section-pad"><div className="closing-mark"><Command size={34}/><span>AUTO<br/>COMPRESS</span></div><div className="closing-copy"><div className="section-number">AUTOCOMPRESS / WINDOWS 10 & 11</div><h2>Make file work<br/>a little more <em>automatic.</em></h2><p>Explore the current Windows release, read the setup guide and see exactly which processors are supported.</p><div className="hero-buttons"><a className="btn btn-dark" href={RELEASE} target="_blank" rel="noreferrer"><MonitorDown size={17}/> View Windows release <ArrowUpRight size={15}/></a><a className="btn btn-light" href={GITHUB} target="_blank" rel="noreferrer"><Github size={17}/> View source</a></div><small>Version 0.1.0 · Windows x64 · Unsigned installer</small></div></div></section>
    </main>
    <footer className="site-footer"><div className="footer-main"><a className="wordmark" href="#"><span className="wordmark-icon"><Command size={19}/></span><span>auto<span>compress</span></span></a><p>A calmer way to handle the files that keep piling up.</p><div className="footer-links"><a href={GITHUB+'/blob/main/USER_GUIDE.md'}>User guide</a><a href={GITHUB+'/blob/main/SECURITY.md'}>Security</a><a href={GITHUB+'/blob/main/SUPPORTED_FORMATS.md'}>Formats</a><a href={GITHUB} target="_blank" rel="noreferrer">GitHub <ArrowUpRight size={13}/></a></div></div><div className="footer-legal"><span>© 2026 AutoCompress · Independent open-source project</span><span>Built for Windows. Files stay local.</span></div></footer>
  </div>;
}

export default App;
