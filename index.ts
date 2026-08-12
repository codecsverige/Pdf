import { registerRootComponent } from 'expo';
import React from 'react';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';

import App from './DashboardApp';

function Root() {
  return React.createElement(
    SafeAreaProvider,
    { initialMetrics: initialWindowMetrics },
    React.createElement(App),
  );
}

registerRootComponent(Root);
