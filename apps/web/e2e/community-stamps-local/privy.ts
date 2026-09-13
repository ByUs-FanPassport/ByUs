const getAccessToken = async () => "community-stamps-loopback";
export const usePrivy = () => {
 const signedIn = new URLSearchParams(location.search).get("auth") !== "off";
 return { ready:true, authenticated:signedIn, user:signedIn?{id:"did:privy:community-stamps-loopback"}:null, getAccessToken };
};
