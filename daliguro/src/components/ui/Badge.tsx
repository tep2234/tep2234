interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'purple' | 'teal' | 'blue' | 'green' | 'amber' | 'red' | 'gray' | 'dark';
  size?: 'sm' | 'md';
  className?: string;
}

const variantMap = {
  default: 'bg-gray-100 text-gray-700',
  purple: 'bg-purple-100 text-purple-700',
  teal: 'bg-teal-100 text-teal-700',
  blue: 'bg-blue-100 text-blue-700',
  green: 'bg-green-100 text-green-700',
  amber: 'bg-amber-100 text-amber-700',
  red: 'bg-red-100 text-red-700',
  gray: 'bg-gray-200 text-gray-600',
  dark: 'bg-gray-800 text-white',
};

const sizeMap = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-3 py-1 text-sm',
};

export default function Badge({ children, variant = 'default', size = 'sm', className = '' }: BadgeProps) {
  return (
    <span className={`inline-flex items-center font-semibold rounded-full ${variantMap[variant]} ${sizeMap[size]} ${className}`}>
      {children}
    </span>
  );
}
