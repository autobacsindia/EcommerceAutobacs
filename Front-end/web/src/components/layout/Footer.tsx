import Link from 'next/link';
import { APP_NAME, FOOTER_LINKS } from '@/lib/constants';
import { CreditCard, Lock, ShieldCheck, Facebook, Twitter, Instagram, Youtube } from 'lucide-react';

const CURRENT_YEAR = new Date().getFullYear();

export default function Footer() {
  return (
    <footer className="bg-[#0E0E0E] border-t border-[#252525] text-[#C4C4C4]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="space-y-4">
            <h3 className="text-white font-condensed font-bold text-2xl uppercase tracking-wide">{APP_NAME}</h3>
            <p className="text-sm text-[#555555] font-body">
              Premium automotive accessories and performance parts for your car.
            </p>
            <div className="flex space-x-4">
              <a href="#" className="text-[#555555] hover:text-[#3B9EE8] transition-colors"><Facebook className="h-5 w-5" /></a>
              <a href="#" className="text-[#555555] hover:text-[#3B9EE8] transition-colors"><Twitter className="h-5 w-5" /></a>
              <a href="#" className="text-[#555555] hover:text-[#3B9EE8] transition-colors"><Instagram className="h-5 w-5" /></a>
              <a href="#" className="text-[#555555] hover:text-[#3B9EE8] transition-colors"><Youtube className="h-5 w-5" /></a>
            </div>
          </div>

          {/* Company */}
          <div>
            <h4 className="text-white font-condensed font-bold uppercase tracking-widest text-sm mb-4">Company</h4>
            <ul className="space-y-2">
              {FOOTER_LINKS.company.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm text-[#555555] hover:text-[#3B9EE8] transition-colors font-body">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Support */}
          <div>
            <h4 className="text-white font-condensed font-bold uppercase tracking-widest text-sm mb-4">Support</h4>
            <ul className="space-y-2">
              {FOOTER_LINKS.support.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm text-[#555555] hover:text-[#3B9EE8] transition-colors font-body">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="text-white font-condensed font-bold uppercase tracking-widest text-sm mb-4">Legal</h4>
            <ul className="space-y-2">
              {FOOTER_LINKS.legal.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm text-[#555555] hover:text-[#3B9EE8] transition-colors font-body">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="border-t border-[#252525] mt-12 pt-8">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-sm text-[#555555] font-body">
              &copy; {CURRENT_YEAR} Roavion Private LTD. All rights reserved.
            </p>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2 text-sm text-[#555555]">
                <Lock className="h-4 w-4" />
                <span className="font-body">SSL Secured</span>
              </div>
              <div className="flex items-center gap-4">
                <CreditCard className="h-6 w-6 text-[#555555]" />
                <div className="flex items-center gap-1">
                  <ShieldCheck className="h-5 w-5 text-[#3B9EE8]" />
                  <span className="text-xs font-condensed font-bold text-[#C4C4C4] uppercase tracking-widest">Verified</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
