import './global.css';
import { StatusBar } from 'expo-status-bar';
import { StyleGate } from './src/StyleGate';

export default function App() {
  return (
    <>
      <StyleGate />
      <StatusBar style="auto" />
    </>
  );
}
