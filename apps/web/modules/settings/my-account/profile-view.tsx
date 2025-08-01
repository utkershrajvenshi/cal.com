"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { revalidateSettingsProfile } from "app/cache/path/settings/my-account";
// eslint-disable-next-line no-restricted-imports
import { get, pick } from "lodash";
import { signOut, useSession } from "next-auth/react";
import type { BaseSyntheticEvent } from "react";
import React, { useRef, useState } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { z } from "zod";

import { ErrorCode } from "@calcom/features/auth/lib/ErrorCode";
import { Dialog } from "@calcom/features/components/controlled-dialog";
import SectionBottomActions from "@calcom/features/settings/SectionBottomActions";
import SettingsHeader from "@calcom/features/settings/appDir/SettingsHeader";
import { DisplayInfo } from "@calcom/features/users/components/UserTable/EditSheet/DisplayInfo";
import { APP_NAME, FULL_NAME_LENGTH_MAX_LIMIT } from "@calcom/lib/constants";
import { emailSchema } from "@calcom/lib/emailSchema";
import { getUserAvatarUrl } from "@calcom/lib/getAvatarUrl";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { md } from "@calcom/lib/markdownIt";
import turndown from "@calcom/lib/turndownService";
import { IdentityProvider } from "@calcom/prisma/enums";
import type { RouterOutputs } from "@calcom/trpc/react";
import { trpc } from "@calcom/trpc/react";
import type { AppRouter } from "@calcom/trpc/types/server/routers/_app";
import { Alert } from "@calcom/ui/components/alert";
import { UserAvatar } from "@calcom/ui/components/avatar";
import { Button } from "@calcom/ui/components/button";
import { DialogContent, DialogFooter, DialogTrigger, DialogClose } from "@calcom/ui/components/dialog";
import { Editor } from "@calcom/ui/components/editor";
import { Form } from "@calcom/ui/components/form";
import { PasswordField } from "@calcom/ui/components/form";
import { Label } from "@calcom/ui/components/form";
import { TextField } from "@calcom/ui/components/form";
import { Icon } from "@calcom/ui/components/icon";
import { ImageUploader } from "@calcom/ui/components/image-uploader";
import { showToast } from "@calcom/ui/components/toast";

import TwoFactor from "@components/auth/TwoFactor";
import CustomEmailTextField from "@components/settings/CustomEmailTextField";
import SecondaryEmailConfirmModal from "@components/settings/SecondaryEmailConfirmModal";
import SecondaryEmailModal from "@components/settings/SecondaryEmailModal";
import { UsernameAvailabilityField } from "@components/ui/UsernameAvailability";

import type { TRPCClientErrorLike } from "@trpc/client";

interface DeleteAccountValues {
  totpCode: string;
}

type Email = {
  id: number;
  email: string;
  emailVerified: string | null;
  emailPrimary: boolean;
};

export type FormValues = {
  username: string;
  avatarUrl: string | null;
  name: string;
  email: string;
  bio: string;
  secondaryEmails: Email[];
};
type Props = {
  user: RouterOutputs["viewer"]["me"]["get"];
};

const ProfileView = ({ user }: Props) => {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const { update } = useSession();
  const updateProfileMutation = trpc.viewer.me.updateProfile.useMutation({
    onSuccess: async (res) => {
      await update(res);
      utils.viewer.me.invalidate();
      utils.viewer.me.shouldVerifyEmail.invalidate();
      revalidateSettingsProfile();

      if (res.hasEmailBeenChanged && res.sendEmailVerification) {
        showToast(t("change_of_email_toast", { email: tempFormValues?.email }), "success");
      } else {
        showToast(t("settings_updated_successfully"), "success");
      }

      setTempFormValues(null);
    },
    onError: (e) => {
      switch (e.message) {
        // TODO: Add error codes.
        case "email_already_used":
          {
            showToast(t(e.message), "error");
          }
          return;
        default:
          showToast(t("error_updating_settings"), "error");
      }
    },
  });
  const unlinkConnectedAccountMutation = trpc.viewer.loggedInViewerRouter.unlinkConnectedAccount.useMutation({
    onSuccess: async (res) => {
      showToast(t(res.message), "success");
      utils.viewer.me.invalidate();
      revalidateSettingsProfile();
    },
    onError: (e) => {
      showToast(t(e.message), "error");
    },
  });

  const addSecondaryEmailMutation = trpc.viewer.loggedInViewerRouter.addSecondaryEmail.useMutation({
    onSuccess: (res) => {
      setShowSecondaryEmailModalOpen(false);
      setNewlyAddedSecondaryEmail(res?.data?.email);
      utils.viewer.me.invalidate();
      revalidateSettingsProfile();
    },
    onError: (error) => {
      setSecondaryEmailAddErrorMessage(error?.message || "");
    },
  });

  const resendVerifyEmailMutation = trpc.viewer.auth.resendVerifyEmail.useMutation();

  const [confirmPasswordOpen, setConfirmPasswordOpen] = useState(false);
  const [tempFormValues, setTempFormValues] = useState<ExtendedFormValues | null>(null);
  const [confirmPasswordErrorMessage, setConfirmPasswordDeleteErrorMessage] = useState("");
  const [showCreateAccountPasswordDialog, setShowCreateAccountPasswordDialog] = useState(false);
  const [showAccountDisconnectWarning, setShowAccountDisconnectWarning] = useState(false);
  const [showSecondaryEmailModalOpen, setShowSecondaryEmailModalOpen] = useState(false);
  const [secondaryEmailAddErrorMessage, setSecondaryEmailAddErrorMessage] = useState("");
  const [newlyAddedSecondaryEmail, setNewlyAddedSecondaryEmail] = useState<undefined | string>(undefined);

  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [hasDeleteErrors, setHasDeleteErrors] = useState(false);
  const [deleteErrorMessage, setDeleteErrorMessage] = useState("");
  const form = useForm<DeleteAccountValues>();

  const onDeleteMeSuccessMutation = async () => {
    await utils.viewer.me.invalidate();
    revalidateSettingsProfile();

    showToast(t("Your account was deleted"), "success");

    setHasDeleteErrors(false); // dismiss any open errors
    if (process.env.NEXT_PUBLIC_WEBAPP_URL === "https://app.cal.com") {
      signOut({ callbackUrl: "/auth/logout?survey=true" });
    } else {
      signOut({ callbackUrl: "/auth/logout" });
    }
  };

  const confirmPasswordMutation = trpc.viewer.auth.verifyPassword.useMutation({
    onSuccess() {
      if (tempFormValues) updateProfileMutation.mutate(tempFormValues);
      setConfirmPasswordOpen(false);
    },
    onError() {
      setConfirmPasswordDeleteErrorMessage(t("incorrect_password"));
    },
  });

  const onDeleteMeErrorMutation = (error: TRPCClientErrorLike<AppRouter>) => {
    setHasDeleteErrors(true);
    setDeleteErrorMessage(errorMessages[error.message]);
  };
  const deleteMeMutation = trpc.viewer.me.deleteMe.useMutation({
    onSuccess: onDeleteMeSuccessMutation,
    onError: onDeleteMeErrorMutation,
    async onSettled() {
      await utils.viewer.me.invalidate();
      revalidateSettingsProfile();
    },
  });
  const deleteMeWithoutPasswordMutation = trpc.viewer.me.deleteMeWithoutPassword.useMutation({
    onSuccess: onDeleteMeSuccessMutation,
    onError: onDeleteMeErrorMutation,
    async onSettled() {
      await utils.viewer.me.invalidate();
      revalidateSettingsProfile();
    },
  });

  const isCALIdentityProvider = user?.identityProvider === IdentityProvider.CAL;

  const onConfirmPassword = (e: Event | React.MouseEvent<HTMLElement, MouseEvent>) => {
    e.preventDefault();

    const password = passwordRef.current.value;
    confirmPasswordMutation.mutate({ passwordInput: password });
  };

  const onConfirmButton = (e: Event | React.MouseEvent<HTMLElement, MouseEvent>) => {
    e.preventDefault();
    if (isCALIdentityProvider) {
      const totpCode = form.getValues("totpCode");
      const password = passwordRef.current.value;
      deleteMeMutation.mutate({ password, totpCode });
    } else {
      deleteMeWithoutPasswordMutation.mutate();
    }
  };

  const onConfirm = ({ totpCode }: DeleteAccountValues, e: BaseSyntheticEvent | undefined) => {
    e?.preventDefault();
    if (isCALIdentityProvider) {
      const password = passwordRef.current.value;
      deleteMeMutation.mutate({ password, totpCode });
    } else {
      deleteMeWithoutPasswordMutation.mutate();
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const passwordRef = useRef<HTMLInputElement>(null!);

  const errorMessages: { [key: string]: string } = {
    [ErrorCode.SecondFactorRequired]: t("2fa_enabled_instructions"),
    [ErrorCode.IncorrectPassword]: `${t("incorrect_password")} ${t("please_try_again")}`,
    [ErrorCode.UserNotFound]: t("no_account_exists"),
    [ErrorCode.IncorrectTwoFactorCode]: `${t("incorrect_2fa_code")} ${t("please_try_again")}`,
    [ErrorCode.InternalServerError]: `${t("something_went_wrong")} ${t("please_try_again_and_contact_us")}`,
    [ErrorCode.ThirdPartyIdentityProviderEnabled]: t("account_created_with_identity_provider"),
  };

  const userEmail = user.email || "";
  const defaultValues = {
    username: user.username || "",
    avatarUrl: user.avatarUrl,
    name: user.name || "",
    email: userEmail,
    bio: user.bio || "",
    // We add the primary email as the first item in the list
    secondaryEmails: [
      {
        id: 0,
        email: userEmail,
        emailVerified: user.emailVerified?.toString() || null,
        emailPrimary: true,
      },
      ...(user.secondaryEmails || []).map((secondaryEmail) => ({
        ...secondaryEmail,
        emailVerified: secondaryEmail.emailVerified?.toString() || null,
        emailPrimary: false,
      })),
    ],
  };

  return (
    <SettingsHeader
      title={t("profile")}
      description={t("profile_description", { appName: APP_NAME })}
      borderInShellHeader={true}>
      <ProfileForm
        key={JSON.stringify(defaultValues)}
        defaultValues={defaultValues}
        isPending={updateProfileMutation.isPending}
        isFallbackImg={!user.avatarUrl}
        user={user}
        userOrganization={user.organization}
        onSubmit={(values) => {
          if (values.email !== user.email && isCALIdentityProvider) {
            setTempFormValues(values);
            setConfirmPasswordOpen(true);
          } else {
            updateProfileMutation.mutate(values);
          }
        }}
        handleAddSecondaryEmail={() => setShowSecondaryEmailModalOpen(true)}
        handleResendVerifyEmail={(email) => {
          resendVerifyEmailMutation.mutate({ email });
          showToast(t("email_sent"), "success");
        }}
        handleAccountDisconnect={(values) => {
          if (isCALIdentityProvider) return;
          if (user?.passwordAdded) {
            setTempFormValues(values);
            setShowAccountDisconnectWarning(true);
            return;
          }
          setShowCreateAccountPasswordDialog(true);
        }}
        extraField={
          <div className="mt-6">
            <UsernameAvailabilityField
              onSuccessMutation={async () => {
                showToast(t("settings_updated_successfully"), "success");
                await utils.viewer.me.invalidate();
                revalidateSettingsProfile();
              }}
              onErrorMutation={() => {
                showToast(t("error_updating_settings"), "error");
              }}
            />
          </div>
        }
        isCALIdentityProvider={isCALIdentityProvider}
      />

      <div className="border-subtle mt-6 rounded-lg rounded-b-none border border-b-0 p-6">
        <Label className="mb-0 text-base font-semibold text-red-700">{t("danger_zone")}</Label>
        <p className="text-subtle text-sm">{t("account_deletion_cannot_be_undone")}</p>
      </div>
      {/* Delete account Dialog */}
      <Dialog open={deleteAccountOpen} onOpenChange={setDeleteAccountOpen}>
        <SectionBottomActions align="end">
          <DialogTrigger asChild>
            <Button data-testid="delete-account" color="destructive" className="mt-1" StartIcon="trash-2">
              {t("delete_account")}
            </Button>
          </DialogTrigger>
        </SectionBottomActions>
        <DialogContent
          title={t("delete_account_modal_title")}
          description={t("confirm_delete_account_modal", { appName: APP_NAME })}
          type="creation"
          Icon="triangle-alert">
          <>
            <div className="mb-10">
              <p className="text-subtle mb-4 text-sm">{t("delete_account_confirmation_message")}</p>
              {isCALIdentityProvider && (
                <PasswordField
                  data-testid="password"
                  name="password"
                  id="password"
                  autoComplete="current-password"
                  required
                  label="Password"
                  ref={passwordRef}
                />
              )}

              {user?.twoFactorEnabled && isCALIdentityProvider && (
                <Form handleSubmit={onConfirm} className="pb-4" form={form}>
                  <TwoFactor center={false} />
                </Form>
              )}

              {hasDeleteErrors && <Alert severity="error" title={deleteErrorMessage} />}
            </div>
            <DialogFooter showDivider>
              <DialogClose />
              <Button
                color="primary"
                data-testid="delete-account-confirm"
                onClick={(e) => onConfirmButton(e)}
                loading={deleteMeMutation.isPending}>
                {t("delete_my_account")}
              </Button>
            </DialogFooter>
          </>
        </DialogContent>
      </Dialog>

      {/* If changing email, confirm password */}
      <Dialog open={confirmPasswordOpen} onOpenChange={setConfirmPasswordOpen}>
        <DialogContent
          title={t("confirm_password")}
          description={t("confirm_password_change_email")}
          type="creation"
          Icon="triangle-alert">
          <div className="mb-10">
            <div className="mb-4 grid gap-2 md:grid-cols-2">
              <div>
                <span className="text-emphasis mb-2 block text-sm font-medium leading-none">
                  {t("old_email_address")}
                </span>
                <p className="text-subtle leading-none">{user.email}</p>
              </div>
              <div>
                <span className="text-emphasis mb-2 block text-sm font-medium leading-none">
                  {t("new_email_address")}
                </span>
                <p className="text-subtle leading-none">{tempFormValues?.email}</p>
              </div>
            </div>
            <PasswordField
              data-testid="password"
              name="password"
              id="password"
              autoComplete="current-password"
              required
              label="Password"
              ref={passwordRef}
            />

            {confirmPasswordErrorMessage && <Alert severity="error" title={confirmPasswordErrorMessage} />}
          </div>
          <DialogFooter showDivider>
            <Button
              data-testid="profile-update-email-submit-button"
              color="primary"
              loading={confirmPasswordMutation.isPending}
              onClick={(e) => onConfirmPassword(e)}>
              {t("confirm")}
            </Button>
            <DialogClose />
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showCreateAccountPasswordDialog} onOpenChange={setShowCreateAccountPasswordDialog}>
        <DialogContent
          title={t("create_account_password")}
          description={t("create_account_password_hint")}
          type="creation"
          Icon="triangle-alert">
          <DialogFooter>
            <DialogClose />
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAccountDisconnectWarning} onOpenChange={setShowAccountDisconnectWarning}>
        <DialogContent
          title={t("disconnect_account")}
          description={t("disconnect_account_hint")}
          type="creation"
          Icon="triangle-alert">
          <DialogFooter>
            <Button
              color="primary"
              onClick={() => {
                unlinkConnectedAccountMutation.mutate();
                setShowAccountDisconnectWarning(false);
              }}>
              {t("confirm")}
            </Button>
            <DialogClose />
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showSecondaryEmailModalOpen && (
        <SecondaryEmailModal
          isLoading={addSecondaryEmailMutation.isPending}
          errorMessage={secondaryEmailAddErrorMessage}
          handleAddEmail={(values) => {
            setSecondaryEmailAddErrorMessage("");
            addSecondaryEmailMutation.mutate(values);
          }}
          onCancel={() => {
            setSecondaryEmailAddErrorMessage("");
            setShowSecondaryEmailModalOpen(false);
          }}
          clearErrorMessage={() => {
            addSecondaryEmailMutation.reset();
            setSecondaryEmailAddErrorMessage("");
          }}
        />
      )}
      {!!newlyAddedSecondaryEmail && (
        <SecondaryEmailConfirmModal
          email={newlyAddedSecondaryEmail}
          onCancel={() => setNewlyAddedSecondaryEmail(undefined)}
        />
      )}
    </SettingsHeader>
  );
};

type SecondaryEmailApiPayload = {
  id: number;
  email: string;
  isDeleted: boolean;
};

type ExtendedFormValues = Omit<FormValues, "secondaryEmails"> & {
  secondaryEmails: SecondaryEmailApiPayload[];
};

const ProfileForm = ({
  defaultValues,
  onSubmit,
  handleAddSecondaryEmail,
  handleResendVerifyEmail,
  handleAccountDisconnect,
  extraField,
  isPending = false,
  isFallbackImg,
  user,
  userOrganization,
  isCALIdentityProvider,
}: {
  defaultValues: FormValues;
  onSubmit: (values: ExtendedFormValues) => void;
  handleAddSecondaryEmail: () => void;
  handleResendVerifyEmail: (email: string) => void;
  handleAccountDisconnect: (values: ExtendedFormValues) => void;
  extraField?: React.ReactNode;
  isPending: boolean;
  isFallbackImg: boolean;
  user: RouterOutputs["viewer"]["me"]["get"];
  userOrganization: RouterOutputs["viewer"]["me"]["get"]["organization"];
  isCALIdentityProvider: boolean;
}) => {
  const { t } = useLocale();
  const [firstRender, setFirstRender] = useState(true);

  const profileFormSchema = z.object({
    username: z.string(),
    avatarUrl: z.string().nullable(),
    name: z
      .string()
      .trim()
      .min(1, t("you_need_to_add_a_name"))
      .max(FULL_NAME_LENGTH_MAX_LIMIT, {
        message: t("max_limit_allowed_hint", { limit: FULL_NAME_LENGTH_MAX_LIMIT }),
      }),
    email: emailSchema,
    bio: z.string(),
    secondaryEmails: z.array(
      z.object({
        id: z.number(),
        email: emailSchema,
        emailVerified: z.union([z.string(), z.null()]).optional(),
        emailPrimary: z.boolean().optional(),
      })
    ),
  });

  const formMethods = useForm<FormValues>({
    defaultValues,
    resolver: zodResolver(profileFormSchema),
  });

  const {
    fields: secondaryEmailFields,
    remove: deleteSecondaryEmail,
    replace: updateAllSecondaryEmailFields,
  } = useFieldArray({
    control: formMethods.control,
    name: "secondaryEmails",
    keyName: "itemId",
  });

  const getUpdatedFormValues = (values: FormValues) => {
    const changedFields = formMethods.formState.dirtyFields?.secondaryEmails || [];
    const updatedValues: FormValues = {
      ...values,
    };

    // If the primary email is changed, we will need to update
    const primaryEmailIndex = updatedValues.secondaryEmails.findIndex(
      (secondaryEmail) => secondaryEmail.emailPrimary
    );
    if (primaryEmailIndex >= 0) {
      // Add the new updated value as primary email
      updatedValues.email = updatedValues.secondaryEmails[primaryEmailIndex].email;
    }

    // We will only send the emails which have already changed
    const updatedEmails: Email[] = [];
    changedFields.map((field, index) => {
      // If the email changed and if its only secondary email, we add it for updation, the first
      // item in the list is always primary email
      if (field?.email && updatedValues.secondaryEmails[index]?.id) {
        updatedEmails.push(updatedValues.secondaryEmails[index]);
      }
    });

    const deletedEmails = (user?.secondaryEmails || []).filter(
      (secondaryEmail) => !updatedValues.secondaryEmails.find((val) => val.id && val.id === secondaryEmail.id)
    );
    const secondaryEmails = [
      ...updatedEmails.map((email) => ({ ...email, isDeleted: false })),
      ...deletedEmails.map((email) => ({ ...email, isDeleted: true })),
    ].map((secondaryEmail) => pick(secondaryEmail, ["id", "email", "isDeleted"]));

    return {
      ...updatedValues,
      secondaryEmails,
    };
  };

  const handleFormSubmit = (values: FormValues) => {
    onSubmit(getUpdatedFormValues(values));
  };

  const onDisconnect = () => {
    handleAccountDisconnect(getUpdatedFormValues(formMethods.getValues()));
  };

  const { data: usersAttributes, isPending: usersAttributesPending } =
    trpc.viewer.attributes.getByUserId.useQuery({
      userId: user.id,
    });

  const {
    formState: { isSubmitting, isDirty },
  } = formMethods;

  const isDisabled = isSubmitting || !isDirty;
  return (
    <Form form={formMethods} handleSubmit={handleFormSubmit}>
      <div className="border-subtle border-x px-4 pb-10 pt-8 sm:px-6">
        <div className="flex items-center">
          <Controller
            control={formMethods.control}
            name="avatarUrl"
            render={({ field: { value, onChange } }) => {
              const showRemoveAvatarButton = value !== null;
              return (
                <>
                  <UserAvatar data-testid="profile-upload-avatar" previewSrc={value} size="lg" user={user} />
                  <div className="ms-4">
                    <h2 className="mb-2 text-sm font-medium">{t("profile_picture")}</h2>
                    <div className="flex gap-2">
                      <ImageUploader
                        target="avatar"
                        id="avatar-upload"
                        buttonMsg={t("upload_avatar")}
                        handleAvatarChange={(newAvatar) => {
                          onChange(newAvatar);
                        }}
                        imageSrc={getUserAvatarUrl({ avatarUrl: value })}
                        triggerButtonColor={showRemoveAvatarButton ? "secondary" : "secondary"}
                      />

                      {showRemoveAvatarButton && (
                        <Button
                          color="destructive"
                          onClick={() => {
                            onChange(null);
                          }}>
                          {t("remove")}
                        </Button>
                      )}
                    </div>
                  </div>
                </>
              );
            }}
          />
        </div>
        {extraField}
        <p className="text-subtle mt-1 flex gap-1 text-sm">
          <Icon name="info" className="mt-0.5 flex-shrink-0" />
          <span className="flex-1">{t("tip_username_plus")}</span>
        </p>
        <div className="mt-6">
          <TextField label={t("full_name")} {...formMethods.register("name")} />
        </div>
        <div className="mt-6">
          <Label>{t("email")}</Label>
          <div className="-mt-2 flex flex-wrap items-start gap-2">
            <div
              className={
                secondaryEmailFields.length > 1 ? "grid w-full grid-cols-1 gap-2 sm:grid-cols-2" : "flex-1"
              }>
              {secondaryEmailFields.map((field, index) => (
                <CustomEmailTextField
                  key={field.itemId}
                  formMethods={formMethods}
                  formMethodFieldName={`secondaryEmails.${index}.email` as keyof FormValues}
                  errorMessage={get(formMethods.formState.errors, `secondaryEmails.${index}.email.message`)}
                  emailVerified={Boolean(field.emailVerified)}
                  emailPrimary={field.emailPrimary}
                  dataTestId={`profile-form-email-${index}`}
                  handleChangePrimary={() => {
                    const fields = secondaryEmailFields.map((secondaryField, cIndex) => ({
                      ...secondaryField,
                      emailPrimary: cIndex === index,
                    }));
                    updateAllSecondaryEmailFields(fields);
                  }}
                  handleVerifyEmail={() => handleResendVerifyEmail(field.email)}
                  handleItemDelete={() => deleteSecondaryEmail(index)}
                />
              ))}
            </div>
            <Button
              color="secondary"
              StartIcon="plus"
              className="mt-2"
              onClick={() => handleAddSecondaryEmail()}
              data-testid="add-secondary-email">
              {t("add_email")}
            </Button>
          </div>
        </div>
        <div className="mt-6">
          <Label>{t("about")}</Label>
          <Editor
            getText={() => md.render(formMethods.getValues("bio") || "")}
            setText={(value: string) => {
              formMethods.setValue("bio", turndown(value), { shouldDirty: true });
            }}
            excludedToolbarItems={["blockType"]}
            disableLists
            firstRender={firstRender}
            setFirstRender={setFirstRender}
            height="120px"
          />
        </div>
        {usersAttributes && usersAttributes?.length > 0 && (
          <div className="mt-6 flex flex-col">
            <Label>{t("attributes")}</Label>
            <div className="flex flex-col space-y-4">
              {usersAttributes.map((attribute, index) => (
                <>
                  <DisplayInfo
                    key={index}
                    label={attribute.name}
                    labelClassname="font-normal text-sm text-subtle"
                    valueClassname="text-emphasis inline-flex items-center gap-1 font-normal text-sm leading-5"
                    value={
                      ["TEXT", "NUMBER", "SINGLE_SELECT"].includes(attribute.type)
                        ? attribute.options[0].value
                        : attribute.options.map((option) => option.value)
                    }
                  />
                </>
              ))}
            </div>
          </div>
        )}
        {/* // For Non-Cal identities, we merge the values from DB and the user logging in,
        so essentially there's no point in allowing them to disconnect, since when they log in they will get logged into the same account */}
        {!isCALIdentityProvider && user.email !== user.identityProviderEmail && (
          <div className="mt-6">
            <Label>Connected accounts</Label>
            <div className="flex items-center">
              <span className="text-default text-sm capitalize">{user.identityProvider.toLowerCase()}</span>
              {user.identityProviderEmail && (
                <span className="text-default ml-2 text-sm">{user.identityProviderEmail}</span>
              )}
              <div className="flex flex-1 justify-end">
                <Button color="destructive" onClick={onDisconnect}>
                  {t("disconnect")}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
      <SectionBottomActions align="end">
        <Button
          loading={isPending}
          disabled={isDisabled}
          color="primary"
          type="submit"
          data-testid="profile-submit-button">
          {t("update")}
        </Button>
      </SectionBottomActions>
    </Form>
  );
};

export default ProfileView;
