import React from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider, Tooltip, createTheme } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { App } from './App';
import { TOOLTIP_PROPS } from './components/Glasseffect';

import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import './styles.css';

const theme = createTheme({
  primaryColor: 'indigo',
  defaultRadius: 'sm',
  components: {
    // Every tooltip in the app: 2s hover delay, small, no arrow.
    // Both Glasseffect.tsx and NormalLook.tsx export the same TOOLTIP_PROPS.
    Tooltip: Tooltip.extend({ defaultProps: TOOLTIP_PROPS })
  }
});

const container = document.getElementById('root');
if (!container) throw new Error('Root container missing');
createRoot(container).render(
  <React.StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="dark">
      <Notifications position="bottom-right" />
      <App />
    </MantineProvider>
  </React.StrictMode>
);