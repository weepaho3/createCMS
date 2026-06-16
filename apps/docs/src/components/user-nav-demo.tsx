'use client';

import {
  ChevronsUpDown,
  LogOutIcon,
  type LucideIcon,
  SettingsIcon,
  UserIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Skeleton } from './ui/skeleton';

// Mock Data
const mockSession = {
  user: {
    name: 'John Doe',
    email: 'john@example.com',
    image: 'https://github.com/shadcn.png',
  },
};

const getInitials = (name: string) => name.slice(0, 2).toUpperCase();

type BaseMenuItem = {
  label: string;
  icon: LucideIcon | string;
};

type LinkMenuItem = BaseMenuItem & {
  type: 'link';
  href: string;
};

type ActionMenuItem = BaseMenuItem & {
  type: 'action';
  action: (() => void) | string;
};

type MenuItem = LinkMenuItem | ActionMenuItem;

interface UserNavProps {
  menuItems: MenuItem[];
  width?: number;
  variant?: 'default' | 'outline';
  collapsed?: boolean;
  dropdownWidth?: number;
  userInfoHeader?: boolean;
  simulatePending?: boolean;
  pendingDurationMs?: number;
  className?: string;
}

const UserInfo = ({
  name,
  email,
  image,
}: {
  name?: string;
  email?: string;
  image?: string | null;
}) => {
  return (
    <>
      <Avatar className="after:border-none">
        <AvatarImage src={image || ''} alt={name} />
        <AvatarFallback className="bg-primary/10 text-primary/80">
          {getInitials(name || '')}
        </AvatarFallback>
      </Avatar>
      <div className="grid flex-1 text-left text-sm leading-tight font-normal">
        <span className="truncate font-medium">{name}</span>
        <span className="text-muted-foreground truncate text-xs">{email}</span>
      </div>
    </>
  );
};

const UserInfoSkeleton = () => {
  return (
    <>
      <Skeleton className="size-8 min-w-8 min-h-8 rounded-full" />
      <div className="grid flex-1 text-left text-sm leading-tight">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="mt-1 h-3 w-full" />
      </div>
    </>
  );
};

const Icon = ({ icon }: { icon: LucideIcon | string }) => {
  if (typeof icon === 'string') {
    if (icon === 'UserIcon') return <UserIcon className="h-4 w-4" />;
    if (icon === 'SettingsIcon') return <SettingsIcon className="h-4 w-4" />;
    return null;
  }
  const IconComponent = icon;
  return <IconComponent className="h-4 w-4" />;
};

const UserMenuContent = ({ item }: { item: MenuItem }) => {
  if (item.type === 'link') {
    return (
      <DropdownMenuItem key={item.label} render={<Link href={item.href} />}>
        <Icon icon={item.icon} />
        {item.label}
      </DropdownMenuItem>
    );
  }

  const handleAction = () => {
    if (typeof item.action === 'function') {
      item.action();
    } else if (typeof item.action === 'string') {
      console.log(`Action triggered: ${item.action}`);
    }
  };

  return (
    <DropdownMenuItem key={item.label} onSelect={handleAction}>
      <Icon icon={item.icon} />
      {item.label}
    </DropdownMenuItem>
  );
};

export const UserNavDemo = ({
  menuItems,
  width,
  variant = 'default',
  collapsed,
  dropdownWidth,
  userInfoHeader = true,
  simulatePending = false,
  pendingDurationMs = 1200,
  className,
}: UserNavProps) => {
  // Use mock session
  const session = mockSession;
  const [isPending, setIsPending] = useState(Boolean(simulatePending));

  useEffect(() => {
    if (!simulatePending) return;
    setIsPending(true);
    const t = setTimeout(() => setIsPending(false), pendingDurationMs);
    return () => clearTimeout(t);
  }, [simulatePending, pendingDurationMs]);

  const handleSignOut = () => {
    window.alert('Sign out action triggered');
  };

  const isCollapsed = !!collapsed;

  return (
    <div className="flex items-center justify-between  not-prose  rounded-lg">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant={variant === 'outline' ? 'outline' : 'ghost'}
              className={[
                isCollapsed
                  ? 'size-8 rounded-full border-none'
                  : 'h-12 justify-start gap-2',
                className,
              ]
                .filter(Boolean)
                .join(' ')}
              style={!isCollapsed ? { width: `${width}px` } : undefined}
            >
              {isCollapsed ? (
                isPending ? (
                  <Skeleton className="size-8 min-w-8 min-h-8 rounded-full border-none" />
                ) : (
                  <Avatar className="size-8 p-0 border-none after:border-none">
                    <AvatarImage
                      src={session?.user.image || ''}
                      alt={session?.user.name || ''}
                    />
                    <AvatarFallback className="bg-primary/10 text-primary/80">
                      {getInitials(session?.user.name || '')}
                    </AvatarFallback>
                  </Avatar>
                )
              ) : isPending ? (
                <>
                  <UserInfoSkeleton />
                  <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                </>
              ) : (
                <>
                  <UserInfo
                    name={session?.user.name}
                    email={session?.user.email}
                    image={session?.user.image}
                  />
                  <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                </>
              )}
            </Button>
          }
        />

        <DropdownMenuContent style={{ width: dropdownWidth }}>
          {userInfoHeader && (
            <>
              <div className="flex items-center gap-2 p-1">
                <UserInfo
                  name={session?.user.name}
                  email={session?.user.email}
                  image={session?.user.image}
                />
              </div>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuGroup>
            {menuItems.map((item) => (
              <UserMenuContent key={item.label} item={item} />
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={handleSignOut}>
            <LogOutIcon />
            Sign Out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};
