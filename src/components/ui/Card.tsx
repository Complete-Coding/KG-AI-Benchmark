import { HTMLAttributes, ReactNode } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  hover?: boolean;
  children: ReactNode;
}

const Card = ({ hover = false, className = '', children, ...props }: CardProps) => {
  const baseClasses =
    'bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-6 transition-theme';

  const hoverClasses = hover
    ? 'hover:-translate-y-1 hover:shadow-md transition-all duration-200'
    : '';

  return (
    <div className={`${baseClasses} ${hoverClasses} ${className}`} {...props}>
      {children}
    </div>
  );
};

export default Card;
