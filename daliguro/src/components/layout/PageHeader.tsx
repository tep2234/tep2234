import React from 'react';

interface PageHeaderProps {
  badge?: string;
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}

export default function PageHeader({ badge, title, subtitle, children }: PageHeaderProps) {
  return (
    <div className="bg-gradient-to-r from-[#0F1629] to-[#1B2035] text-white px-6 py-6">
      <div className="max-w-7xl mx-auto flex items-start justify-between gap-4">
        <div>
          {badge && (
            <span className="inline-block bg-white/10 text-white/80 text-xs font-bold tracking-widest px-3 py-1 rounded-full mb-2 uppercase">
              {badge}
            </span>
          )}
          <h1 className="text-2xl font-bold">{title}</h1>
          {subtitle && <p className="text-white/60 text-sm mt-1">{subtitle}</p>}
        </div>
        {children && <div className="flex items-center gap-2 flex-shrink-0">{children}</div>}
      </div>
    </div>
  );
}
