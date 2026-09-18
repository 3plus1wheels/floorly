import React, { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { MapPin, BrainCircuit, Activity, CheckCircle, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import FloorlyLogo from './FloorlyLogo';
import './LandingPage.css';

gsap.registerPlugin(ScrollTrigger);

const RETAIL_BG = 'https://images.unsplash.com/photo-1555529733-0e670560f7e1?q=80&w=2000&auto=format&fit=crop';
const PHILOSOPHY_BG = 'https://images.unsplash.com/photo-1542314831-c6a4d14faaf2?q=80&w=2000&auto=format&fit=crop';

function Navbar() {
  const navRef = useRef(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      ScrollTrigger.create({
        start: 'top -50',
        end: 99999,
        toggleClass: { className: 'scrolled', targets: navRef.current },
        onToggle: (self) => {
          if (self.isActive) {
            gsap.to(navRef.current, {
              backgroundColor: 'rgba(250, 248, 245, 0.7)',
              backdropFilter: 'blur(20px)',
              borderColor: 'rgba(13, 13, 18, 0.1)',
              color: '#0D0D12',
              duration: 0.3
            });
          } else {
            gsap.to(navRef.current, {
              backgroundColor: 'transparent',
              backdropFilter: 'blur(0px)',
              borderColor: 'transparent',
              color: '#FAF8F5',
              duration: 0.3
            });
          }
        }
      });
    }, navRef);
    return () => ctx.revert();
  }, []);

  return (
    <nav ref={navRef} className="fixed top-6 left-1/2 -translate-x-1/2 z-50 flex items-center justify-between px-8 py-4 rounded-full border border-transparent w-[90%] max-w-5xl text-[#FAF8F5] transition-colors">
      <FloorlyLogo size="sm" color="currentColor" className="leading-none" />
      <div className="hidden md:flex gap-8 font-medium text-sm items-center">
        <a href="#features" className="hover-lift">Platform</a>
        <a href="#philosophy" className="hover-lift">Philosophy</a>
        <a href="#protocol" className="hover-lift">Protocol</a>
      </div>
      <Link to="/login" className="magnet-btn bg-[#C9A84C] text-[#0D0D12] text-sm font-semibold px-6 py-2.5 rounded-full inline-flex items-center">
        Sign In
      </Link>
    </nav>
  );
}

function Hero() {
  const container = useRef(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from('.hero-anim', {
        y: 40,
        opacity: 0,
        duration: 1.2,
        stagger: 0.08,
        ease: 'power3.out',
        delay: 0.2
      });
    }, container);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={container} className="relative h-[100dvh] w-full flex items-end pb-24 px-8 md:px-20 bg-noise bg-[#0D0D12]">
      <div className="absolute inset-0 overflow-hidden">
        <img src={RETAIL_BG} alt="Hero" className="w-full h-full object-cover opacity-60 mix-blend-luminosity" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0D0D12] via-[#0D0D12]/70 to-transparent"></div>
      </div>

      <div className="relative z-10 max-w-6xl w-full">
        <div className="flex flex-col gap-2">
          <p className="hero-anim text-sm font-data text-[#C9A84C] tracking-widest uppercase mb-4">Daily Retail Business Management</p>
          <h1 className="hero-anim text-[#FAF8F5] font-bold text-5xl md:text-7xl lg:text-8xl tracking-tight leading-[0.9]">
            RETAIL EXCELLENCE <span className="font-normal font-drama block mt-2 italic text-[#C9A84C]"></span>
          </h1>
          <p className="hero-anim text-[#FAF8F5]/80 text-lg md:text-xl max-w-xl mt-6">
            Zone associates based on skill level. Eradicate retail guesswork. Establish a daily operational pulse for peak store performance.
          </p>
          <div className="hero-anim mt-10">
            <Link to="/login" className="magnet-btn bg-[#C9A84C] text-[#0D0D12] text-lg font-semibold px-8 py-4 rounded-full inline-flex items-center gap-2 hover:bg-[#D5B863]">
              Sign in to start <ChevronRight className="w-5 h-5" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function DiagnosticCard() {
  const cardsRef = useRef([]);

  useEffect(() => {
    let current = 0;
    const interval = setInterval(() => {
      current++;
      cardsRef.current.forEach((el, idx) => {
        const diff = (idx - current) % 3;
        const offset = diff < 0 ? diff + 3 : diff;

        gsap.to(el, {
          y: offset * -15,
          scale: 1 - offset * 0.05,
          opacity: offset === 2 ? 0 : 1 - offset * 0.3,
          zIndex: 3 - offset,
          duration: 0.8,
          ease: 'back.out(1.5)'
        });
      });
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-[#FAF8F5] rounded-panel p-8 border border-[#2A2A35]/10 shadow-[0_20px_40px_-15px_rgba(13,13,18,0.1)] flex flex-col h-[400px]">
      <div className="mb-auto">
        <MapPin className="text-[#C9A84C] w-8 h-8 mb-6" />
        <h3 className="text-2xl font-bold text-[#0D0D12] tracking-tight">Statistical Precision, Not Guesswork</h3>
        <p className="text-[#2A2A35]/70 mt-3 font-medium">Zone your strongest associates in peak traffic areas.</p>
      </div>

      <div className="relative h-[120px] mt-8 w-full">
        {[
          { color: 'bg-[#0D0D12]', text: 'Front Entrance: Skill Level 9' },
          { color: 'bg-[#1A1A24]', text: 'Fitting Rooms: Skill Level 8' },
          { color: 'bg-[#2A2A35]', text: 'Register: Skill Level 7' }
        ].map((item, i) => (
          <div
            key={i}
            ref={(el) => (cardsRef.current[i] = el)}
            className={`absolute top-0 left-0 right-0 p-4 rounded-2xl text-[#FAF8F5] font-data text-sm tracking-tight ${item.color}`}
            style={{ transform: `translateY(${i * -15}px) scale(${1 - i * 0.05})`, zIndex: 3 - i, opacity: 1 - i * 0.3 }}
          >
            <div className="flex justify-between items-center">
              <span>{item.text}</span>
              <Activity className="w-4 h-4 text-[#C9A84C]" />
            </div>
            <div className="h-1 bg-white/20 mt-3 rounded-full overflow-hidden">
              <div className="h-full bg-[#C9A84C] rounded-full" style={{ width: `${80 - i * 15}%` }}></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TypewriterCard() {
  const [text, setText] = useState('');
  const fullText = 'SYSTEM_SYNC: Updating daily pulse... \n\n[10:04] Shift aligned.\n[11:30] Traffic spike predicted.\n[14:00] Re-zoning optimized.';

  useEffect(() => {
    let currentIndex = 0;
    const timer = setInterval(() => {
      if (currentIndex <= fullText.length) {
        setText(fullText.slice(0, currentIndex));
        currentIndex++;
      } else {
        currentIndex = 0;
        setText('');
      }
    }, 80);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="bg-[#FAF8F5] rounded-panel p-8 border border-[#2A2A35]/10 shadow-[0_20px_40px_-15px_rgba(13,13,18,0.1)] flex flex-col h-[400px]">
      <div className="mb-auto">
        <Activity className="text-[#C9A84C] w-8 h-8 mb-6" />
        <h3 className="text-2xl font-bold text-[#0D0D12] tracking-tight">Daily Operational Pulse</h3>
        <p className="text-[#2A2A35]/70 mt-3 font-medium">Real-time insight bridging strategy and exact front-line execution.</p>
      </div>

      <div className="mt-8 bg-[#0D0D12] text-[#C9A84C] font-data text-xs p-5 rounded-2xl h-[120px] shadow-inner relative flex flex-col">
        <div className="flex items-center gap-2 mb-3 select-none">
          <span className="w-2 h-2 rounded-full bg-[#E63B2E] animate-pulse"></span>
          <span className="text-[#FAF8F5]/60 tracking-wider">LIVE FEED</span>
        </div>
        <div className="whitespace-pre-wrap leading-relaxed flex-1 overflow-hidden">
          {text}<span className="inline-block w-2 bg-[#C9A84C] animate-pulse ml-1">&nbsp;</span>
        </div>
      </div>
    </div>
  );
}

function SchedulerCard() {
  const cursorRef = useRef(null);
  const cellRef = useRef(null);

  useEffect(() => {
    const tl = gsap.timeline({ repeat: -1, repeatDelay: 1 });

    tl.set(cursorRef.current, { x: 0, y: 0, scale: 1 })
      .to(cursorRef.current, { x: 60, y: -20, duration: 1, ease: 'power2.inOut' })
      .to(cursorRef.current, { scale: 0.9, duration: 0.1, yoyo: true, repeat: 1 })
      .to(cellRef.current, { backgroundColor: '#C9A84C', color: '#0D0D12', duration: 0.2 }, '-=0.1')
      .to(cursorRef.current, { x: 140, y: 30, duration: 0.8, ease: 'power2.inOut', delay: 0.5 })
      .to(cursorRef.current, { scale: 0.9, duration: 0.1, yoyo: true, repeat: 1 })
      .to(cellRef.current, { backgroundColor: '#F0ECE1', color: '#0D0D12', duration: 0.2 }, '+=1');

    return () => tl.kill();
  }, []);

  return (
    <div className="bg-[#FAF8F5] rounded-panel p-8 border border-[#2A2A35]/10 shadow-[0_20px_40px_-15px_rgba(13,13,18,0.1)] flex flex-col h-[400px]">
      <div className="mb-auto">
        <BrainCircuit className="text-[#C9A84C] w-8 h-8 mb-6" />
        <h3 className="text-2xl font-bold text-[#0D0D12] tracking-tight">The Heatmap of Opportunity</h3>
        <p className="text-[#2A2A35]/70 mt-3 font-medium">Identify peak demand and map associate strength dynamically.</p>
      </div>

      <div className="mt-8 relative p-5 bg-[#F0ECE1] rounded-2xl h-[120px] flex items-center justify-center">
        <div className="grid grid-cols-5 gap-2 w-full max-w-[200px] z-10">
          {['M', 'T', 'W', 'T', 'F'].map((day, i) => (
            <div
              key={day}
              ref={i === 2 ? cellRef : null}
              className="aspect-square rounded flex items-center justify-center font-data text-xs font-medium bg-white shadow-sm text-[#0D0D12]"
            >
              {day}
            </div>
          ))}
        </div>

        <div ref={cursorRef} className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none origin-top-left" style={{ transformOrigin: '20% 20%' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-md">
            <path d="M5.5 3.21V20.8C5.5 21.43 6.2 21.8 6.7 21.43L11.43 17.84H17.5C18.13 17.84 18.5 17.13 18.13 16.6L5.5 3.21Z" fill="#0D0D12" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
    </div>
  );
}

function Philosophy() {
  const textRef = useRef(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from('.phil-line', {
        scrollTrigger: {
          trigger: textRef.current,
          start: 'top 75%'
        },
        y: 30,
        opacity: 0,
        duration: 1,
        stagger: 0.2,
        ease: 'power3.out'
      });
    }, textRef);
    return () => ctx.revert();
  }, []);

  return (
    <section id="philosophy" className="relative py-32 px-8 md:px-20 bg-[#0D0D12] bg-noise overflow-hidden">
      <div className="absolute inset-0">
        <img src={PHILOSOPHY_BG} alt="Philosophy" className="w-full h-full object-cover opacity-10 mix-blend-color-dodge transition-transform duration-1000" />
      </div>

      <div ref={textRef} className="relative z-10 max-w-4xl mx-auto text-left py-20">
        <p className="phil-line text-[#FAF8F5]/60 text-xl md:text-2xl font-medium tracking-tight mb-8">
          Most retail scheduling focuses on: <span className="text-[#FAF8F5]">generic headcounts and blank coverage arrays.</span>
        </p>
        <h2 className="phil-line font-drama italic text-5xl md:text-7xl lg:text-8xl text-[#FAF8F5] leading-tight">
          We focus on:
          <br />
          <span className="text-[#C9A84C]">Skill-based placement.</span>
        </h2>
      </div>
    </section>
  );
}

function ProtocolCard({ title, desc, animType, index }) {
  return (
    <div className="h-[100dvh] w-full flex items-center justify-center sticky top-0 protocol-card p-4" style={{ zIndex: index }}>
      <div className="w-full max-w-5xl bg-[#FAF8F5] p-12 md:p-20 rounded-[3rem] shadow-2xl border border-[#2A2A35]/10 flex flex-col md:flex-row items-center justify-between gap-12 protocol-inner">
        <div className="flex-1">
          <span className="font-data text-[#C9A84C] text-lg font-medium mb-6 block">{(index + 1).toString().padStart(2, '0')}</span>
          <h2 className="text-4xl md:text-6xl font-bold text-[#0D0D12] tracking-tight mb-6">{title}</h2>
          <p className="text-xl text-[#2A2A35]/70 font-medium leading-relaxed max-w-lg">{desc}</p>
        </div>

        <div className="w-full md:w-1/2 aspect-square bg-[#1A1A24] rounded-full flex items-center justify-center shadow-inner overflow-hidden flex-shrink-0">
          {animType === 1 && (
            <div className="w-40 h-40 border-[3px] border-[#C9A84C]/50 rounded-full flex justify-center items-center animate-spin-slow" style={{ animationDuration: '10s' }}>
              <div className="w-24 h-24 border-[3px] border-[#C9A84C] rounded-full"></div>
            </div>
          )}
          {animType === 2 && (
            <div className="relative w-40 h-40 grid grid-cols-4 gap-2">
              {Array.from({ length: 16 }).map((_, i) => (
                <div key={i} className="bg-[#2A2A35] rounded-sm"></div>
              ))}
              <div className="absolute top-0 bottom-0 w-1 bg-[#C9A84C] left-0 shadow-[0_0_15px_#C9A84C] animate-scanner"></div>
            </div>
          )}
          {animType === 3 && (
            <svg viewBox="0 0 100 50" className="w-40 stroke-[#C9A84C] stroke-2 fill-none overflow-visible">
              <path d="M 0 25 L 20 25 L 30 15 L 40 45 L 50 5 L 60 40 L 70 25 L 100 25" strokeDasharray="200" className="animate-pulse-path" />
            </svg>
          )}
        </div>
      </div>
    </div>
  );
}

function Protocol() {
  const containerRef = useRef(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      const cards = gsap.utils.toArray('.protocol-card');

      cards.forEach((card, i) => {
        if (i === cards.length - 1) return;

        const inner = card.querySelector('.protocol-inner');

        gsap.to(inner, {
          scrollTrigger: {
            trigger: cards[i + 1],
            start: 'top bottom',
            end: 'top top',
            scrub: true
          },
          scale: 0.9,
          opacity: 0.3,
          filter: 'blur(10px)',
          ease: 'none'
        });
      });
    }, containerRef);
    return () => ctx.revert();
  }, []);

  return (
    <section id="protocol" ref={containerRef} className="relative bg-[#FAF8F5] pb-32">
      <ProtocolCard
        index={0}
        animType={1}
        title="Associate Audit"
        desc="Connect existing staffing data to evaluate the individual capabilities, strengths, and historical performance of every associate."
      />
      <ProtocolCard
        index={1}
        animType={2}
        title="Zone Mapping"
        desc="Scan your retail footprint. Our system automatically designates prime high-traffic sectors and maps them precisely."
      />
      <ProtocolCard
        index={2}
        animType={3}
        title="Execution Deployment"
        desc="Schedule generation prioritizing tactical capability metrics over generic spreadsheet headcounts."
      />
    </section>
  );
}

function Footer() {
  return (
    <footer className="bg-[#0D0D12] text-[#FAF8F5] pt-24 pb-12 px-8 md:px-20 rounded-t-[4rem] relative z-20 mt-[-4rem]">
      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 mb-20">
        <div className="lg:col-span-2">
          <FloorlyLogo size="md" color="#FAF8F5" className="mb-4" />
          <p className="text-[#FAF8F5]/60 max-w-sm mb-8">Daily retail business management tracking tactical precision in associates.</p>
          <div className="flex items-center gap-3 font-data text-xs">
            <span className="w-2 h-2 rounded-full bg-[#34D399] animate-pulse"></span>
            <span className="tracking-widest opacity-80 uppercase">System Operational</span>
          </div>
        </div>

        <div>
          <h4 className="font-semibold mb-6">Platform</h4>
          <ul className="space-y-4 text-[#FAF8F5]/60 text-sm">
            <li><a href="#features" className="hover:text-[#C9A84C] transition-colors">Zoning Logic</a></li>
            <li><a href="#features" className="hover:text-[#C9A84C] transition-colors">Skill Metrics</a></li>
            <li><a href="#protocol" className="hover:text-[#C9A84C] transition-colors">Enterprise API</a></li>
          </ul>
        </div>

        <div>
          <h4 className="font-semibold mb-6">Company</h4>
          <ul className="space-y-4 text-[#FAF8F5]/60 text-sm">
            <li><a href="#philosophy" className="hover:text-[#C9A84C] transition-colors">Philosophy</a></li>
            <li><Link to="/login" className="hover:text-[#C9A84C] transition-colors">Sign In</Link></li>
            <li><Link to="/privacy" className="hover:text-[#C9A84C] transition-colors">Privacy Policy</Link></li>
            <li><Link to="/support" className="hover:text-[#C9A84C] transition-colors">Support</Link></li>
          </ul>
        </div>
      </div>

      <div className="max-w-6xl mx-auto pt-8 border-t border-[#FAF8F5]/10 flex flex-col md:flex-row justify-between items-center text-xs text-[#FAF8F5]/40 font-data uppercase tracking-widest gap-4">
        <p>&copy; {new Date().getFullYear()} Floorly Systems. All rights strict.</p>
      </div>
    </footer>
  );
}

function Pricing() {
  return (
    <section className="py-32 px-8 md:px-20 bg-[#FAF8F5] relative">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-20">
          <h2 className="text-4xl md:text-5xl font-bold text-[#0D0D12] tracking-tight mb-4">Ascend the Protocol</h2>
          <p className="text-[#2A2A35]/60 text-lg max-w-xl mx-auto">Select a system tier calibrated to your operation's scale and required precision.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-center">
          <div className="bg-white rounded-panel p-10 border border-[#2A2A35]/10 shadow-lg flex flex-col hover-lift">
            <h3 className="font-semibold text-xl mb-2">Essential</h3>
            <p className="text-[#2A2A35]/60 text-sm mb-8">For single-unit execution.</p>
            <div className="mb-8">
              <span className="text-4xl font-bold tracking-tight">$0</span><span className="text-[#2A2A35]/50">/mo</span>
            </div>
            <ul className="space-y-4 mb-10 flex-1">
              {['Basic Associate Mapping', 'Static Heatmaps'].map((feature, i) => (
                <li key={i} className="flex gap-3 text-sm font-medium">
                  <CheckCircle className="text-[#0D0D12] w-5 h-5 flex-shrink-0" /> {feature}
                </li>
              ))}
            </ul>
            <button className="w-full py-3 rounded-full font-semibold border-2 border-[#0D0D12] text-[#0D0D12] hover:bg-[#0D0D12] hover:text-white transition-colors">Acquire Core</button>
          </div>

          <div className="bg-[#0D0D12] rounded-panel p-10 border-2 border-[#C9A84C] shadow-2xl flex flex-col transform md:scale-105 z-10 hover-lift text-[#FAF8F5]">
            <h3 className="font-semibold text-xl mb-2">Performance</h3>
            <p className="text-[#FAF8F5]/60 text-sm mb-8">For multi-unit daily pulses.</p>
            <div className="mb-8 flex items-end justify-between">
              <div>
                <span className="text-4xl font-bold tracking-tight text-[#C9A84C]">$2,500</span><span className="text-[#FAF8F5]/50">/yr</span>
              </div>
            </div>
            <ul className="space-y-4 mb-10 flex-1">
              {['Dynamic Skill Zoning', 'Real-Time Operational Pulse', 'Advanced Shift Predictions'].map((feature, i) => (
                <li key={i} className="flex gap-3 text-sm font-medium">
                  <CheckCircle className="text-[#C9A84C] w-5 h-5 flex-shrink-0" /> {feature}
                </li>
              ))}
            </ul>
            <Link to="/login" className="w-full py-3 rounded-full font-semibold bg-[#C9A84C] text-[#0D0D12] hover:bg-[#D5B863] transition-colors text-center">Sign In</Link>
          </div>

          <div className="bg-white rounded-panel p-10 border border-[#2A2A35]/10 shadow-lg flex flex-col hover-lift">
            <h3 className="font-semibold text-xl mb-2">Enterprise</h3>
            <p className="text-[#2A2A35]/60 text-sm mb-8">Full fleet mastery.</p>
            <div className="mb-8">
              <span className="text-4xl font-bold tracking-tight">Custom</span>
            </div>
            <ul className="space-y-4 mb-10 flex-1">
              {['Complete API Access', 'Custom AI Modeling', 'White-glove deployment'].map((feature, i) => (
                <li key={i} className="flex gap-3 text-sm font-medium">
                  <CheckCircle className="text-[#0D0D12] w-5 h-5 flex-shrink-0" /> {feature}
                </li>
              ))}
            </ul>
            <button className="w-full py-3 rounded-full font-semibold border-2 border-[#0D0D12] text-[#0D0D12] hover:bg-[#0D0D12] hover:text-white transition-colors">Start the Dialog</button>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function LandingPage() {
  return (
    <div className="bg-[#FAF8F5] min-h-screen text-[#2A2A35] font-sans antialiased selection:bg-[#C9A84C] selection:text-[#0D0D12]">
      <style>{`
        @keyframes scanner { 0% { transform: translateX(0); } 100% { transform: translateX(160px); } }
        .animate-scanner { animation: scanner 2s ease-in-out infinite alternate; }

        @keyframes pulsePath { 0% { stroke-dashoffset: 200; } 100% { stroke-dashoffset: 0; } }
        .animate-pulse-path { animation: pulsePath 3s linear infinite; }

        .animate-spin-slow { animation: spin 10s linear infinite; }
      `}</style>

      <Navbar />
      <Hero />

      <section id="features" className="py-32 px-8 md:px-20 bg-noise">
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">
          <DiagnosticCard />
          <TypewriterCard />
          <SchedulerCard />
        </div>
      </section>

      <Philosophy />
      <Protocol />
      <Pricing />
      <Footer />
    </div>
  );
}
