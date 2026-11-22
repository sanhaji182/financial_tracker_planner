import React from 'react';
import { HelpCircle } from 'lucide-react';
import { CATEGORY_ICON_MAP } from '../../utils/categoryIcons';

interface CategoryIconProps {
  icon?: string | null;
  className?: string;
}

export const CategoryIcon: React.FC<CategoryIconProps> = ({ icon, className = 'h-4 w-4' }) => {
  const trimmed = icon?.trim() || '';
  const MappedIcon = trimmed ? CATEGORY_ICON_MAP[trimmed.toLowerCase()] : undefined;

  if (MappedIcon) {
    return <MappedIcon className={className} aria-hidden="true" />;
  }

  if (trimmed) {
    return (
      <span className="leading-none select-none" aria-hidden="true">
        {trimmed.slice(0, 2)}
      </span>
    );
  }

  return <HelpCircle className={className} aria-hidden="true" />;
};

export default CategoryIcon;
