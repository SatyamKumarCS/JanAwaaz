import { Pressable, Text, View } from 'react-native';
import { useColorScheme } from 'nativewind';

// I-01 styling gate (D-17 Q2): classes, dark mode and a 360 px-wide layout.
export function StyleGate() {
  const { colorScheme, toggleColorScheme } = useColorScheme();
  return (
    <View className="flex-1 items-center justify-center bg-white dark:bg-neutral-900 px-4">
      <View className="w-full max-w-[360px] rounded-xl border border-neutral-300 dark:border-neutral-700 p-4">
        <Text className="text-2xl font-bold text-neutral-900 dark:text-white">जन आवाज़ · Jan Awaaz</Text>
        <Text className="mt-2 text-base text-neutral-700 dark:text-neutral-300">
          Scaffold placeholder. NativeWind styling gate — mode: {colorScheme}
        </Text>
        <Pressable
          onPress={toggleColorScheme}
          className="mt-4 min-h-[48px] items-center justify-center rounded-lg bg-emerald-600 active:bg-emerald-700"
        >
          <Text className="text-lg font-semibold text-white">Toggle dark mode</Text>
        </Pressable>
      </View>
    </View>
  );
}
