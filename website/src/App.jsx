import React, { useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUpRight, Check, ChevronDown, Command, FileArchive, FileAudio, FileImage, FileText, Folder, Github, HardDrive, LockKeyhole, Menu, Monitor, Play, ShieldCheck, Sparkles, Zap } from 'lucide-react';

const GITHUB = 'https://github.com/marazinaburahman-design/AutoCompress';
const RELEASE = 'https://github.com/marazinaburahman-design/AutoCompress/releases/latest';

const faqs = [
  ['Does AutoCompress upload my files?', 'No. AutoCompress is designed to process files locally on your Windows computer. Your files stay on your device.'],
  ['Are my original files changed?', 'No. Processing creates a separate output file. The original source file is preserved.'],
  ['Which operating systems are supported?', 'The current release is for Windows 10/11, 64-bit. A macOS version is not currently available.'],
  ['Can it automatically process files in a folder?', 'Yes. You can configure watched folders and automation rules. AutoCompress waits for files to finish copying and avoids monitoring its configured output folder.'],
  ['Does it convert every file format?', 'No. Support depends on the processor. Some formats are optimized or reserialized without changing their underlying content. Check the supported formats guide for exact details.'],
  ['Is the installer signed?', 'The current Windows installer is unsigned, so Windows SmartScreen may show a warning.']
];

function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState(0);
  const links = [['Features','#features'],['How it works','#how'],['Formats','#formats'],['FAQ','#faq']];
  return <div className="site-shell">
    <div className="announcement"><span className="announce-dot" /> AutoCompress for Windows <span className="announce-divider">·</span> Version 0.1.0 <a href={RELEASE}>View release <ArrowUpRight size={13}/></a></div>
    <header className="nav-wrap"><a className="brand" href="#"><span className="brand-mark"><Command size={19}/></span><span>auto<span className="brand-light">compress</span></span></a>
      <nav className={menuOpen?'nav-links open':'nav-links'}>{links.map(([label,href])=><a key={href} href={href} onClick={()=>setMenuOpen(false)}>{label}</a>)}<a href={GITHUB} target="_blank" rel="noreferrer">GitHub <ArrowUpRight size={13}/></a></nav>
      <a className="nav-cta" href={RELEASE} target="_blank" rel="noreferrer">Get the app <ArrowRight size={15}/></a>
      <button className="mobile-menu" onClick={()=>setMenuOpen(!menuOpen)} aria-label="Toggle navigation"><Menu/></button>
    </header>

    <main>
      <section className="hero section-width">
        <div className="hero-copy"><div className="eyebrow"><span className="eyebrow-line"/> A calmer way to manage files</div>
          <h1>Your files.<br/><span>Taken care of.</span></h1>
          <p className="hero-sub">A quiet little desktop assistant that watches your folders and handles file processing automatically. Less busywork. More peace of mind.</p>
          <div className="hero-actions"><a className="button button-primary" href={RELEASE} target="_blank" rel="noreferrer"><Monitor size={17}/> Download for Windows <ArrowUpRight size={15}/></a><a className="button button-ghost" href={GITHUB} target="_blank" rel="noreferrer"><Github size={17}/> Explore on GitHub</a></div>
          <div className="hero-meta"><span><Check size={14}/> Local-first processing</span><span><Check size={14}/> Originals stay safe</span><span><Check size={14}/> Windows 10/11</span></div>
        </div>
        <div className="hero-visual">
          <div className="visual-glow"/>
          <div className="app-window">
            <div className="window-top"><div className="window-dots"><i/><i/><i/></div><span>AutoCompress <small>· Workspace</small></span><span className="window-status"><b/> All systems ready</span></div>
            <div className="window-body"><aside className="mock-sidebar"><div className="mock-logo"><span><Command size={14}/></span> AutoCompress</div><div className="side-active">◫ <span>Overview</span></div><div>▧ <span>Process files</span></div><div>◉ <span>Watched folders</span></div><div>⌘ <span>Automation</span></div><div>◷ <span>History</span></div><div className="side-bottom">⚙ <span>Settings</span></div></aside>
              <div className="mock-main"><div className="mock-heading"><div><small>YOUR WORKSPACE</small><h3>Good things are happening.</h3><p>Here's what AutoCompress has been up to.</p></div><span className="mock-date">Today <ChevronDown size={12}/></span></div>
                <div className="stats-grid"><div className="stat-card"><span>Files processed</span><strong>1,284</strong><small className="positive">↗ Your files, handled</small></div><div className="stat-card"><span>Space saved</span><strong>2.4 <em>GB</em></strong><small>Across completed jobs</small></div><div className="stat-card"><span>Watched folders</span><strong>04</strong><small>Automation active</small></div></div>
                <div className="activity-card"><div className="activity-title"><b>Recent activity</b><span>View history <ArrowUpRight size={11}/></span></div>{[['photo-summer.jpg','Image optimized','JPG','1.8 MB','check'],['project-assets.zip','Archive processed','ZIP','24.6 MB','check'],['meeting-notes.pdf','PDF processed','PDF','840 KB','check']].map(x=><div className="activity-row" key={x[0]}><span className="file-icon"><FileImage size={15}/></span><div className="file-name"><b>{x[0]}</b><small>{x[1]}</small></div><span className="file-size">{x[3]}</span><span className="done"><Check size={12}/></span></div>)}</div>
              </div>
            </div>
            <div className="window-footer"><span><span className="live-dot"/> Folder monitoring active</span><span>Everything stays on this device</span></div>
          </div>
          <div className="floating-note"><span className="float-icon"><ShieldCheck size={18}/></span><span><b>Your originals are safe</b><small>Source files are never overwritten</small></span></div>
        </div>
        <div className="hero-bottom"><span>MADE FOR YOUR EVERYDAY WORKFLOW</span><div><span><FileImage/> Images</span><span><FileArchive/> Archives</span><span><FileText/> Documents</span><span><FileAudio/> Audio & video</span></div></div>
      </section>

      <section className="intro-section"><div className="section-width intro-grid"><div className="eyebrow"><span className="eyebrow-line"/> THE IDEA</div><div><h2>Drop the repetitive work.<br/><span>Keep your flow.</span></h2><p>Files arrive from everywhere. Sorting, optimizing and keeping them organized shouldn't become another job. AutoCompress helps take care of supported file-processing tasks in the background, right on your Windows PC.</p></div></div></section>

      <section className="features-section section-width" id="features"><div className="section-heading"><div><div className="eyebrow"><span className="eyebrow-line"/> WHY AUTOCOMPRESS</div><h2>Small tasks, <span>off your plate.</span></h2></div><p>Practical tools for the file work you do every day — without sending your files away.</p></div>
        <div className="feature-grid"><article className="feature-card feature-large"><div className="feature-icon"><Zap/></div><div><h3>Works in the background</h3><p>Choose folders to watch. AutoCompress detects new files, waits for copying to finish, then processes supported files using your configured rules.</p></div><div className="mini-folder"><Folder/><span>Incoming files</span><i/><span className="mini-arrow">→</span><span className="mini-output">Optimized output</span></div></article>
          <article className="feature-card"><div className="feature-icon"><LockKeyhole/></div><h3>Local by design</h3><p>Your files are processed on your computer. No cloud upload or online converter is part of the workflow.</p></article>
          <article className="feature-card"><div className="feature-icon"><ShieldCheck/></div><h3>Originals stay safe</h3><p>Results are written separately. Your original files remain untouched, with collision-safe output names.</p></article>
          <article className="feature-card"><div className="feature-icon"><HardDrive/></div><h3>Know what happened</h3><p>See completed jobs, file sizes, savings, processing duration and failures in your history.</p></article>
          <article className="feature-card"><div className="feature-icon"><Sparkles/></div><h3>Your rules, your workflow</h3><p>Configure watched folders and automation rules, then pause or resume monitoring whenever you need.</p></article>
        </div>
      </section>

      <section className="how-section" id="how"><div className="section-width"><div className="section-heading"><div><div className="eyebrow"><span className="eyebrow-line"/> HOW IT WORKS</div><h2>Set it up once.<br/><span>Let it do its thing.</span></h2></div><p>A straightforward workflow that stays out of your way.</p></div><div className="steps-grid">{[['01','Choose a folder','Select the folders you want AutoCompress to watch.'],['02','Set your rules','Choose how supported file types should be processed.'],['03','Keep working','AutoCompress detects new files and waits until copying is complete.'],['04','Find your results','Processed files are saved separately. Review every job in your history.']].map(([n,t,d])=><div className="step" key={n}><span className="step-number">{n}</span><div className="step-line"/><h3>{t}</h3><p>{d}</p></div>)}</div></div></section>

      <section className="formats-section section-width" id="formats"><div className="section-heading"><div><div className="eyebrow"><span className="eyebrow-line"/> SUPPORTED FORMATS</div><h2>Different files.<br/><span>One place to manage them.</span></h2></div><p>Processing capabilities vary by format. Some operations optimize media; others safely reserialize existing files.</p></div>
        <div className="format-grid"><div className="format-card"><span className="format-symbol"><FileImage/></span><div><h3>Images</h3><p>PNG · JPEG · WebP · AVIF · TIFF</p><small>Convert, optimize and optionally resize.</small></div><span className="format-tag">Image processing</span></div>
          <div className="format-card"><span className="format-symbol"><FileArchive/></span><div><h3>Archives</h3><p>ZIP</p><small>Recompress existing archives. Extraction is not included.</small></div><span className="format-tag">Recompression</span></div>
          <div className="format-card"><span className="format-symbol"><FileText/></span><div><h3>Documents</h3><p>PDF · DOCX · XLSX · PPTX</p><small>Validate and reserialize supported documents.</small></div><span className="format-tag">Safe processing</span></div>
          <div className="format-card"><span className="format-symbol"><FileAudio/></span><div><h3>Media</h3><p>WAV · MP4</p><small>Supported PCM16 WAV processing and MP4 metadata layout optimization.</small></div><span className="format-tag">Format-specific</span></div>
        </div><a className="text-link" href={GITHUB+'/blob/main/SUPPORTED_FORMATS.md'} target="_blank" rel="noreferrer">See exact format support and limitations <ArrowUpRight size={15}/></a>
      </section>

      <section className="privacy-section"><div className="section-width privacy-inner"><div className="privacy-art"><div className="privacy-orbit orbit-one"/><div className="privacy-orbit orbit-two"/><div className="privacy-lock"><LockKeyhole size={44}/></div><span className="privacy-chip chip-a">LOCAL FILES</span><span className="privacy-chip chip-b">NO UPLOADS</span></div><div><div className="eyebrow"><span className="eyebrow-line"/> YOUR FILES ARE YOURS</div><h2>Private isn't a setting.<br/><span>It's the starting point.</span></h2><p>AutoCompress is built as a local-first desktop app. Processing runs on your Windows computer, and your files stay in the folders you choose. No account or cloud storage is needed for the core workflow.</p><a className="text-link" href={GITHUB+'/blob/main/SECURITY.md'} target="_blank" rel="noreferrer">Read the security notes <ArrowUpRight size={15}/></a></div></div></section>

      <section className="faq-section section-width" id="faq"><div className="faq-intro"><div className="eyebrow"><span className="eyebrow-line"/> GOOD TO KNOW</div><h2>Questions, <span>answered.</span></h2><p>Want more technical detail? Visit the project documentation on GitHub.</p><a className="text-link" href={GITHUB} target="_blank" rel="noreferrer">Browse documentation <ArrowUpRight size={15}/></a></div><div className="faq-list">{faqs.map(([q,a],i)=><div className={'faq-item '+(openFaq===i?'active':'')} key={q}><button onClick={()=>setOpenFaq(openFaq===i?-1:i)}><span>{q}</span><ChevronDown size={18}/></button>{openFaq===i&&<p>{a}</p>}</div>)}</div></section>

      <section className="download-section"><div className="section-width download-inner"><div className="download-copy"><div className="eyebrow"><span className="eyebrow-line"/> READY WHEN YOU ARE</div><h2>Give your files<br/>a little <span>less busywork.</span></h2><p>Get AutoCompress for Windows and make file processing a little more automatic.</p><div className="hero-actions"><a className="button button-light" href={RELEASE} target="_blank" rel="noreferrer"><Monitor size={17}/> Get AutoCompress <ArrowUpRight size={15}/></a><a className="button button-outline-light" href={GITHUB} target="_blank" rel="noreferrer"><Github size={17}/> View source</a></div><small className="download-note">Windows 10/11 · 64-bit · Version 0.1.0 · Unsigned installer</small></div><div className="download-stamp"><Command size={52}/><span>A LITTLE MORE<br/>AUTOMATIC.</span><small>AutoCompress · v0.1.0</small></div></div></section>
    </main>
    <footer><div className="section-width footer-top"><a className="brand" href="#"><span className="brand-mark"><Command size={19}/></span><span>auto<span className="brand-light">compress</span></span></a><p>Thoughtful file processing. Right on your desktop.</p><div className="footer-links"><a href={GITHUB+'/blob/main/USER_GUIDE.md'}>User guide</a><a href={GITHUB+'/blob/main/SECURITY.md'}>Security</a><a href={GITHUB+'/blob/main/SUPPORTED_FORMATS.md'}>Formats</a><a href={GITHUB} target="_blank" rel="noreferrer">GitHub <ArrowUpRight size={13}/></a></div></div><div className="section-width footer-bottom"><span>© 2026 AutoCompress. Independent open-source project.</span><span>Built for Windows. Made to keep things simple.</span></div></footer>
  </div>;
}

export default App;
