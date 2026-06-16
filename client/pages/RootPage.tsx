import React from 'react';
import { useAppOptional } from 'ugly-app/client';
import HomePage from './HomePage';
import ChatHomePage from './ChatHomePage';

// Root route ('' / https://ugly.chat/): the marketing landing when logged OUT,
// the conversation-home (ChatHomePage) when logged IN.
export default function RootPage(): React.ReactElement {
  const authed = useAppOptional() !== null;
  return authed ? <ChatHomePage /> : <HomePage />;
}
