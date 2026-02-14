import { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../config/firebase";
import { View, Text } from "react-native";

export default function HomeScreen() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const test = async () => {
      const snapshot = await getDocs(
        collection(db, "private_metered_parking")
      );
      setCount(snapshot.docs.length);
    };

    test();
  }, []);

  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
      <Text>Private Metered Spots: {count}</Text>
    </View>
  );
}
