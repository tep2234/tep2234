import React from 'react';

interface EmptyStateProps {
  icon?: string;
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}

export default function EmptyState({ icon = '📦', title, subtitle, children }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="text-6xl mb-4">{icon}</div>
      <h3 className="text-xl font-bold text-gray-800 mb-2">{title}</h3>
      {subtitle && <p className="text-gray-500 mb-6 max-w-sm">{subtitle}</p>}
      {children && <div className="flex gap-3 flex-wrap justify-center">{children}</div>}
    </div>
  );
}
