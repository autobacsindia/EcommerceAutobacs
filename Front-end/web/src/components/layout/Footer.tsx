import Link from 'next/link';
import { APP_NAME, FOOTER_LINKS } from '@/lib/constants';
import DateTimeDisplay from './DateTimeDisplay';
import { CreditCard, Lock, ShieldCheck, Facebook, Twitter, Instagram, Youtube } from 'lucide-react';

// Use a constant year to prevent hydration issues
const CURRENT_YEAR = new Date().getFullYear();

export default function Footer() {
  return (
    <footer className="bg-gray-900 text-gray-300">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="space-y-4">
            <h3 className="text-white text-2xl font-bold">{APP_NAME}</h3>
            <p className="text-sm text-gray-400">
              Premium automotive accessories and performance parts for your car.
            </p>
            <div className="flex space-x-4">
              <a href="#" className="text-gray-400 hover:text-white transition-colors"><Facebook className="h-5 w-5" /></a>
              <a href="#" className="text-gray-400 hover:text-white transition-colors"><Twitter className="h-5 w-5" /></a>
              <a href="#" className="text-gray-400 hover:text-white transition-colors"><Instagram className="h-5 w-5" /></a>
              <a href="#" className="text-gray-400 hover:text-white transition-colors"><Youtube className="h-5 w-5" /></a>
            </div>
          </div>
          
          {/* Company Links */}
          <div>
            <h4 className="text-white font-semibold mb-4">Company</h4>
            <ul className="space-y-2">
              {FOOTER_LINKS.company.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm hover:text-white transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          
          {/* Support Links */}
          <div>
            <h4 className="text-white font-semibold mb-4">Support</h4>
            <ul className="space-y-2">
              {FOOTER_LINKS.support.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm hover:text-white transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          
          {/* Legal Links */}
          <div>
            <h4 className="text-white font-semibold mb-4">Legal</h4>
            <ul className="space-y-2">
              {FOOTER_LINKS.legal.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm hover:text-white transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
        
        <div className="border-t border-gray-800 mt-12 pt-8">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="text-sm text-gray-400">
              <p>&copy; {CURRENT_YEAR} {APP_NAME}. All rights reserved.</p>
            </div>
            
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <Lock className="h-4 w-4" />
                <span>SSL Secured</span>
              </div>
              <div className="flex items-center gap-4">
                <CreditCard className="h-6 w-6 text-gray-500" />
                <div className="flex items-center gap-1">
                  <ShieldCheck className="h-5 w-5 text-green-500" />
                  <span className="text-xs font-semibold text-gray-400">Verified</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}